mod layout;
mod migration;
mod native;
mod ports;
mod process;
mod state;
mod store;
mod usage;
mod windows;
use serde_json::{json, Value};
use state::State;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use store::{write_json, Result};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

fn publish_usage(app: &AppHandle) {
    let value = app.state::<State>().usage.lock().unwrap().state();
    let _ = app.emit("usage:changed", value);
    windows::reposition(app);
}
fn refresh_claude(app: &AppHandle) {
    let state = app.state::<State>();
    let enabled = state.usage.lock().unwrap().preferences["claude"] == true;
    let connected = state.claude.connected();
    let value = if enabled {
        state.claude.read()
    } else {
        usage::empty("disabled", "표시가 꺼져 있어요.")
    };
    let mut u = state.usage.lock().unwrap();
    let changed = u.providers["claude"] != value || u.connected != connected;
    u.providers["claude"] = value;
    u.connected = connected;
    if changed {
        u.revision += 1;
    }
    drop(u);
    if changed {
        publish_usage(app);
    }
}
fn refresh_codex(app: &AppHandle, manual: bool) {
    let state = app.state::<State>();
    let mut u = state.usage.lock().unwrap();
    if u.preferences["codex"] != true
        || u.active
        || usage::now() - u.last_attempt < if manual { 30000 } else { 300000 }
    {
        return;
    }
    u.last_attempt = usage::now();
    u.active = true;
    u.providers["codex"]["status"] = json!("loading");
    u.providers["codex"]["message"] = json!("확인 중…");
    u.revision += 1;
    let epoch = u.epoch;
    drop(u);
    publish_usage(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<State>();
        let result = if let Some(executable) = usage::find_codex() {
            usage::read_codex(&executable, || {
                !state.stopped.load(Ordering::Relaxed) && state.usage.lock().unwrap().epoch == epoch
            })
        } else {
            Ok(usage::empty(
                "unavailable",
                "Codex CLI를 설치하고 ChatGPT 계정으로 로그인해 주세요.",
            ))
        };
        let mut u = state.usage.lock().unwrap();
        if u.epoch != epoch || state.stopped.load(Ordering::Relaxed) {
            return;
        }
        u.active = false;
        match result {
            Ok(value) => u.providers["codex"] = value,
            Err(error) => {
                u.providers["codex"]["status"] = json!("error");
                u.providers["codex"]["message"] = json!(error);
            }
        }
        u.revision += 1;
        drop(u);
        publish_usage(&app);
    });
}
fn authorized(label: &str, channel: &str) -> bool {
    match channel {
        "modules:get" | "appearance:get" => matches!(label, "pet" | "panel"),
        "usage:get" => matches!(label, "pet" | "panel" | "badge"),
        "usage:open" => matches!(label, "pet" | "badge"),
        "pet:drag" | "pet:hit-region" | "pet:panel-toggle" | "pet:menu" => label == "pet",
        "food:save-text" | "food:save-files" | "panel:close" => matches!(label, "pet" | "panel"),
        _ => label == "panel",
    }
}
/// Binary IPC avoids base64/JSON expansion and uploads one bounded file at a time.
#[tauri::command]
async fn save_file(
    app: AppHandle,
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> std::result::Result<Value, String> {
    use base64::Engine;
    if !matches!(window.label(), "pet" | "panel") {
        return Ok(json!({"ok":false,"error":"허용되지 않은 요청이에요."}));
    }
    let title = request
        .headers()
        .get("x-bytepet-name")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| base64::engine::general_purpose::STANDARD.decode(v).ok())
        .and_then(|v| String::from_utf8(v).ok())
        .ok_or("파일 이름을 확인해 주세요.")?;
    let epoch = request
        .headers()
        .get("x-bytepet-epoch")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or("저장 요청을 확인해 주세요.")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= store::FILE_LIMIT => bytes.clone(),
        _ => return Ok(json!({"ok":false,"error":"파일은 개당 25MB까지 저장할 수 있어요."})),
    };
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
        let state = app.state::<State>();
        let store = state.food.lock().unwrap();
        if !state.active("m01", epoch) {
            return Err("저장 요청이 취소됐어요.".into());
        }
        let item = store.save_bytes(&title, &bytes)?;
        if state.active("m01", epoch) {
            let _ = app.emit("food:saved", json!({"count":1}));
            let _ = app.emit("food:changed", json!({}));
        }
        Ok(item)
    })
    .await
    .map_err(|_| "파일을 저장하지 못했어요.")?;
    Ok(match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    })
}
#[tauri::command]
async fn dispatch(
    app: AppHandle,
    window: WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Value {
    if !authorized(window.label(), &channel) {
        return json!({"ok":false,"error":"허용되지 않은 요청이에요."});
    }
    let result = tauri::async_runtime::spawn_blocking(move || handle(&app, &channel, &args)).await;
    match result {
        Ok(Ok(value)) => json!({"ok":true,"value":value}),
        Ok(Err(error)) => json!({"ok":false,"error":error}),
        Err(_) => json!({"ok":false,"error":"요청을 처리하지 못했어요."}),
    }
}
fn text(value: &Value) -> Result<&str> {
    value
        .as_str()
        .ok_or_else(|| "입력 값을 확인해 주세요.".into())
}
fn handle(app: &AppHandle, channel: &str, args: &[Value]) -> Result<Value> {
    let state = app.state::<State>();
    let arg = args.first().unwrap_or(&Value::Null);
    let second = args.get(1).unwrap_or(&Value::Null);
    match channel {
        "modules:get" => Ok(state.settings.lock().unwrap().modules_state()),
        "appearance:get" => Ok(state.settings.lock().unwrap().appearance_state()),
        "modules:set" => {
            let key = text(&arg["key"])?;
            let enabled = arg["enabled"]
                .as_bool()
                .ok_or("올바른 모듈 설정을 선택해 주세요.")?;
            if !matches!(key, "m01" | "m02") {
                return Err("알 수 없는 모듈".into());
            }
            let mut s = state.settings.lock().unwrap();
            let mut next = s.modules.clone();
            next[key] = json!(enabled);
            write_json(
                &state.root.join("modules.json"),
                &json!({"version":1,"modules":next}),
            )?;
            if s.modules[key] != enabled {
                s.epochs[if key == "m01" { 0 } else { 1 }] += 1;
            }
            s.modules = next;
            s.module_warning = Value::Null;
            s.revision += 1;
            let result = s.modules_state();
            drop(s);
            if key == "m02" {
                *state.ports.lock().unwrap() = ports::Snapshot::empty();
            }
            let _ = app.emit("modules:changed", &result);
            Ok(result)
        }
        "appearance:set" => {
            let key = text(&arg["key"])?;
            if !state::valid_appearance(key, &arg["value"]) {
                return Err("올바른 화면 설정을 선택해 주세요.".into());
            }
            let mut s = state.settings.lock().unwrap();
            let mut next = s.appearance.clone();
            next[key] = arg["value"].clone();
            write_json(
                &state.root.join("appearance.json"),
                &json!({"version":1,"preferences":next}),
            )?;
            s.appearance = next;
            s.appearance_warning = Value::Null;
            s.revision += 1;
            let result = s.appearance_state();
            drop(s);
            state.ui.lock().unwrap().region = Value::Null;
            let _ = app.emit("appearance:changed", &result);
            windows::reposition(app);
            windows::save_position(app)?;
            Ok(result)
        }
        "pet:hit-region" => {
            if layout::valid_region(arg) {
                state.ui.lock().unwrap().region = arg.clone();
            }
            Ok(Value::Null)
        }
        "pet:drag" => {
            windows::drag(app, text(arg)?, second)?;
            Ok(Value::Null)
        }
        "pet:menu" => {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            let settings = MenuItem::with_id(app, "settings", "설정…", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let reset = MenuItem::with_id(app, "reset", "기본 위치로 되돌리기", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let hide = MenuItem::with_id(app, "toggle", "잠시 숨기기", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let quit = MenuItem::with_id(app, "quit", "BytePet Tauri 종료", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
            let menu = Menu::with_items(app, &[&settings, &reset, &hide, &separator, &quit])
                .map_err(|e| e.to_string())?;
            if let Some(pet) = app.get_webview_window("pet") {
                state.ui.lock().unwrap().context_menu = true;
                let _ = pet.set_ignore_cursor_events(false);
                let result = pet.popup_menu(&menu);
                state.ui.lock().unwrap().context_menu = false;
                state.ui.lock().unwrap().ignoring = None;
                result.map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "pet:panel-toggle" => {
            let open = state.ui.lock().unwrap().panel_open;
            if open {
                windows::close(app);
            } else {
                windows::open(app, None);
            }
            Ok(Value::Null)
        }
        "panel:close" => {
            windows::close(app);
            Ok(Value::Null)
        }
        "panel:ready" => {
            state.ui.lock().unwrap().panel_ready = true;
            windows::show_panel(app);
            Ok(Value::Null)
        }
        "panel:view" => Ok(Value::Null),
        "results:copy" => {
            check_module(&state, "m01")?;
            let value = text(arg)?;
            if value.is_empty() || value.len() > 4 * 1024 * 1024 {
                return Err("복사할 결과가 없거나 너무 커요.".into());
            }
            native::clipboard(value)?;
            Ok(Value::Null)
        }
        "results:react" => {
            check_module(&state, "m01")?;
            if matches!(arg.as_str(), Some("processing" | "success" | "failure")) {
                let _ = app.emit("results:reaction", arg);
            }
            Ok(Value::Null)
        }
        "app-preferences:get" => native::app_info(app, state.custom_profile),
        "app-preferences:login" => {
            let enabled = arg
                .as_bool()
                .ok_or("올바른 자동 실행 설정을 선택해 주세요.")?;
            let info = native::app_info(app, state.custom_profile)?;
            native::login(info["login"]["available"] == true, Some(enabled))?;
            native::app_info(app, state.custom_profile)
        }
        "app-preferences:reset-position" => {
            windows::reset(app);
            windows::visibility(app, true);
            Ok(json!({"message":"캐릭터를 기본 위치로 옮겼어요."}))
        }
        "app-preferences:copy-info" => {
            let value = native::app_info(app, state.custom_profile)?;
            let info = &value["info"];
            native::clipboard(&format!(
                "BytePet {}\nmacOS {} ({})\nRuntime: Tauri / WKWebView\nPackaged: {}",
                info["version"].as_str().unwrap_or(""),
                info["systemVersion"].as_str().unwrap_or(""),
                info["arch"].as_str().unwrap_or(""),
                info["packaged"]
            ))?;
            Ok(json!({"message":"앱 정보를 복사했어요."}))
        }
        "usage:get" => Ok(state.usage.lock().unwrap().state()),
        "usage:refresh" => {
            refresh_claude(app);
            refresh_codex(app, true);
            Ok(state.usage.lock().unwrap().state())
        }
        "usage:set" => {
            state
                .usage
                .lock()
                .unwrap()
                .set(&state.root, text(arg)?, second)?;
            refresh_claude(app);
            refresh_codex(app, true);
            publish_usage(app);
            Ok(state.usage.lock().unwrap().state())
        }
        "usage:claude-connect" => {
            state
                .claude
                .connect(arg.as_bool().ok_or("올바른 연결 설정을 선택해 주세요.")?)?;
            refresh_claude(app);
            publish_usage(app);
            Ok(state.usage.lock().unwrap().state())
        }
        "usage:open" => {
            windows::open(app, Some("usage"));
            Ok(Value::Null)
        }
        "ports:list" => {
            let epoch = check_module(&state, "m02")?;
            let snapshot = ports::Snapshot::load()?;
            if !state.active("m02", epoch) {
                return Err("포트 조회가 취소됐어요.".into());
            }
            let value = snapshot.value();
            *state.ports.lock().unwrap() = snapshot;
            Ok(value)
        }
        "ports:open" => {
            let epoch = check_module(&state, "m02")?;
            let (pid, port) = port_target(arg)?;
            let url = {
                let s = state.ports.lock().unwrap();
                s.items
                    .iter()
                    .find(|v| v["pid"] == pid && v["port"] == port)
                    .and_then(ports::url)
                    .ok_or("목록을 새로고침하고 포트를 선택해 주세요.")?
            };
            if !state.active("m02", epoch) {
                return Err("요청을 취소했어요.".into());
            }
            process::text(std::process::Command::new("/usr/bin/open").arg(&url))?;
            Ok(json!({"url":url}))
        }
        "ports:terminate" => terminate(app, arg),
        name if name.starts_with("food:") => food(app, name, arg),
        #[cfg(debug_assertions)]
        "test:snapshot" if state.custom_profile => Ok(json!({
          "pet":app.get_webview_window("pet").and_then(|w|windows::bounds(&w)),
          "panel":app.get_webview_window("panel").and_then(|w|windows::bounds(&w)),
          "badge":app.get_webview_window("badge").and_then(|w|windows::bounds(&w)),
          "badgeVisible":app.get_webview_window("badge").is_some_and(|w|w.is_visible().unwrap_or(false)),
          "badgeNative":native::badge_state(app),
          "region":state.ui.lock().unwrap().region,
        })),
        #[cfg(debug_assertions)]
        "test:report" => {
            if let Some(path) =
                std::env::args().find_map(|a| a.strip_prefix("--smoke-report=").map(PathBuf::from))
            {
                if state.custom_profile {
                    write_json(&path, arg)?;
                    app.exit(if arg["ok"] == true { 0 } else { 1 });
                    return Ok(Value::Null);
                }
            }
            Err("Test reporting is disabled".into())
        }
        _ => Err("지원하지 않는 요청이에요.".into()),
    }
}
fn check_module(state: &State, key: &str) -> Result<u64> {
    let s = state.settings.lock().unwrap();
    if s.modules[key] != true {
        return Err(if key == "m01" {
            "먹이·변환이 꺼져 있어요."
        } else {
            "개발 포트가 꺼져 있어요."
        }
        .into());
    }
    Ok(s.epochs[if key == "m01" { 0 } else { 1 }])
}
fn food(app: &AppHandle, channel: &str, arg: &Value) -> Result<Value> {
    let state = app.state::<State>();
    let epoch = check_module(&state, "m01")?;
    let store = state.food.lock().unwrap();
    if !state.active("m01", epoch) {
        return Err("요청을 취소했어요.".into());
    }
    let id = || text(&arg["id"]);
    let trash = arg["trash"] == true;
    let result = match channel {
        "food:save-text" | "food:save-files" => {
            let mut items = Vec::new();
            let mut errors = Vec::new();
            if channel == "food:save-text" {
                items.push(store.save_text(text(arg)?)?);
            } else {
                if arg["epoch"].as_u64() != Some(epoch) {
                    return Err("저장 요청이 취소됐어요.".into());
                }
                let sources = arg["sources"].as_array().ok_or("파일을 선택해 주세요.")?;
                if sources.is_empty() || sources.len() > 10 {
                    return Err("파일은 한 번에 10개까지 먹일 수 있어요.".into());
                }
                for source in sources {
                    if !state.active("m01", epoch) {
                        errors.push("저장 요청을 취소했어요.".into());
                        break;
                    }
                    match store.save_file(source) {
                        Ok(item) => items.push(item),
                        Err(e) => errors.push(e),
                    }
                }
            }
            if !items.is_empty() && state.active("m01", epoch) {
                let _ = app.emit("food:saved", json!({"count":items.len()}));
                let _ = app.emit("food:changed", json!({}));
            }
            json!({"items":items,"errors":errors})
        }
        "food:list" => store.list(arg["query"].as_str().unwrap_or(""), trash)?,
        "food:thumbnail" => store.thumbnail(id()?, trash, 128)?,
        "food:preview" => {
            let (item, _) = store.get(id()?, trash)?;
            if item["kind"] == "text" {
                json!({"kind":"text","text":store.read_text(id()?,trash)?})
            } else {
                let image = store.thumbnail(id()?, trash, 768)?;
                if image.is_null() {
                    json!({"kind":"file"})
                } else {
                    json!({"kind":"image","image":image})
                }
            }
        }
        "food:rename" => store.rename(id()?, text(&arg["name"])?)?,
        "food:trash" => store.move_item(text(arg)?, false)?,
        "food:restore" => store.move_item(text(arg)?, true)?,
        "food:menu" => store.get(id()?, trash)?.0,
        "food:read-text" => json!(store.read_text(text(arg)?, false)?),
        "food:open" | "food:reveal" => {
            let (_, file) = store.get(text(arg)?, false)?;
            native::open(&file, channel == "food:reveal")?;
            Value::Null
        }
        "food:folder" => {
            fs::create_dir_all(&store.root).map_err(|e| e.to_string())?;
            native::open(&store.root, false)?;
            Value::Null
        }
        _ => return Err("지원하지 않는 보관함 요청".into()),
    };
    if matches!(channel, "food:rename" | "food:trash" | "food:restore") {
        let _ = app.emit("food:changed", json!({}));
    }
    Ok(result)
}
fn port_target(v: &Value) -> Result<(i32, u16)> {
    let pid = v["pid"]
        .as_i64()
        .filter(|p| *p > 0 && *p <= i32::MAX as i64)
        .ok_or("올바른 프로세스를 선택해 주세요.")? as i32;
    let port = v["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or("올바른 포트를 선택해 주세요.")? as u16;
    Ok((pid, port))
}
fn terminate(app: &AppHandle, arg: &Value) -> Result<Value> {
    let state = app.state::<State>();
    let epoch = check_module(&state, "m02")?;
    if state.terminating.swap(true, Ordering::SeqCst) {
        return Err("다른 종료 요청을 처리하고 있어요.".into());
    }
    struct Busy<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Busy<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _busy = Busy(&state.terminating);
    let (pid, port) = port_target(arg)?;
    let identity = {
        let s = state.ports.lock().unwrap();
        if !s.items.iter().any(|v| v["pid"] == pid && v["port"] == port) {
            return Err("목록을 새로고침하고 포트를 선택해 주세요.".into());
        }
        s.identities
            .get(&pid)
            .cloned()
            .ok_or("프로세스 정보를 확인할 수 없어요.")?
    };
    if let Some(reason) = identity.blocked() {
        return Err(reason.into());
    }
    let already =
        || json!({"status":"already-exited","message":format!("PID {pid}는 이미 종료됐어요.")});
    if !ports::verify(&identity, port)? {
        return Ok(already());
    }
    if !state.active("m02", epoch) {
        return Err("종료 요청이 취소됐어요.".into());
    }
    let ports = ports::scan()?
        .iter()
        .filter(|v| v["pid"] == pid)
        .map(|v| v["port"].to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let panel = app
        .get_webview_window("panel")
        .ok_or("메뉴창을 찾지 못했어요.")?;
    let confirmed=app.dialog().message(format!("{}\nPID {pid} · 포트 {ports}\n\n이 프로세스에 종료 신호(SIGTERM)를 보냅니다. 저장하지 않은 작업이 종료될 수 있어요.",identity.command)).title("프로세스를 종료할까요?").parent(&panel).kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancelCustom("종료".into(),"취소".into())).blocking_show();
    if !confirmed {
        return Ok(json!({"status":"cancelled","message":"종료를 취소했어요."}));
    }
    if !state.active("m02", epoch) {
        return Err("종료 요청이 취소됐어요.".into());
    }
    if !ports::verify(&identity, port)? {
        return Ok(already());
    }
    if !state.active("m02", epoch) {
        return Err("종료 요청이 취소됐어요.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let react = |phase: &str| {
        let _ = app.emit("ports:reaction", json!({"id":id,"phase":phase}));
    };
    react("attack");
    if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
        react("failure");
        return Err("프로세스에 종료 신호를 보내지 못했어요.".into());
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        let info = ports::inspect(Some(pid))?;
        if !info
            .get(&pid)
            .is_some_and(|p| p.running() && p.started == identity.started)
        {
            react("success");
            return Ok(
                json!({"status":"terminated","message":format!("PID {pid} 프로세스를 종료했어요.")}),
            );
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    react("failure");
    Err("종료 신호를 보냈지만 아직 실행 중이에요. 잠시 후 새로고침해 주세요.".into())
}
fn menus(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let toggle = MenuItem::with_id(app, "toggle", "캐릭터 표시 / 숨기기", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "설정…", true, Some("CmdOrCtrl+,"))?;
    let reset = MenuItem::with_id(app, "reset", "캐릭터 위치 초기화", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "BytePet Tauri 종료", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &settings,
            &reset,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    tauri::tray::TrayIconBuilder::with_id("bytepet")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("BytePet Tauri Preview")
        .menu(&menu)
        .build(app)?;
    let app_menu = Submenu::with_items(
        app,
        "BytePet Tauri",
        true,
        &[
            &settings,
            &toggle,
            &reset,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "편집",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit])?)?;
    app.on_menu_event(|app, event| match event.id.as_ref() {
        "toggle" => {
            let visible = app.state::<State>().ui.lock().unwrap().visible;
            windows::visibility(app, !visible);
        }
        "settings" => windows::open(app, Some("settings")),
        "reset" => windows::reset(app),
        "quit" => app.exit(0),
        _ => {}
    });
    Ok(())
}
fn main() {
    if let Some(file) = std::env::args()
        .nth(1)
        .filter(|a| a == "--claude-statusline")
        .and_then(|_| std::env::args().nth(2))
    {
        std::process::exit(if usage::statusline(std::path::Path::new(&file)).is_ok() {
            0
        } else {
            1
        });
    }
    let custom =
        std::env::args().find_map(|a| a.strip_prefix("--user-data-dir=").map(PathBuf::from));
    let custom_profile = custom.is_some();
    let root = custom.unwrap_or_else(|| {
        PathBuf::from(std::env::var("HOME").expect("HOME"))
            .join("Library/Application Support/BytePet-Tauri")
    });
    if let Some(source) =
        std::env::args().find_map(|a| a.strip_prefix("--import-electron=").map(PathBuf::from))
    {
        match migration::import(&source, &root) {
            Ok(value) => println!("{value}"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    store::private_dir(&root).expect("create application data");
    let root = root.canonicalize().expect("application data path");
    use fs2::FileExt;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".instance.lock"))
        .expect("instance lock");
    if lock.try_lock_exclusive().is_err() {
        let _ = fs::write(root.join(".show-request"), b"show");
        return;
    }
    let state = State::new(root.clone(), custom_profile);
    #[cfg(debug_assertions)]
    if std::env::args().any(|a| a.starts_with("--smoke-report=")) {
        state.usage.lock().unwrap().preferences["codex"] = json!(false);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![dispatch, save_file])
        .setup(move |app| {
            windows::setup(app.handle())?;
            menus(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut ticks = 0u64;
                while !handle.state::<State>().stopped.load(Ordering::Relaxed) {
                    windows::input_tick(&handle);
                    if ticks.is_multiple_of(250) {
                        refresh_claude(&handle);
                        refresh_codex(&handle, false);
                        windows::reposition(&handle);
                    }
                    if ticks.is_multiple_of(25) && root.join(".show-request").exists() {
                        let _ = fs::remove_file(root.join(".show-request"));
                        windows::visibility(&handle, true);
                    }
                    ticks += 1;
                    std::thread::sleep(Duration::from_millis(20));
                }
            });
            #[cfg(debug_assertions)]
            if let Some(script) =
                std::env::args().find_map(|a| a.strip_prefix("--smoke-script=").map(PathBuf::from))
            {
                if app.state::<State>().custom_profile {
                    let js = fs::read_to_string(script)?;
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        for _ in 0..200 {
                            if handle.state::<State>().ui.lock().unwrap().panel_ready {
                                windows::open(&handle, None);
                                if let Some(window) = handle.get_webview_window("panel") {
                                    let _ = window.eval(js);
                                }
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                    });
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri startup failed");
    app.run(|app, event| match event {
        tauri::RunEvent::Exit => {
            app.state::<State>().stopped.store(true, Ordering::Relaxed);
            let _ = windows::save_position(app);
        }
        tauri::RunEvent::Reopen { .. } => windows::visibility(app, true),
        _ => {}
    });
    drop(lock);
}
