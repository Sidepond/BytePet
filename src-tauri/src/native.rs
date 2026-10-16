use crate::{process, store::Result};
use serde_json::{json, Value};
use std::{path::Path, process::Command, time::Duration};
use tauri::{AppHandle, WebviewWindow};
pub fn open(path: &Path, reveal: bool) -> Result<()> {
    let mut cmd = Command::new("/usr/bin/open");
    if reveal {
        cmd.arg("-R");
    }
    cmd.arg(path);
    process::text(&mut cmd).map(|_| ())
}
pub fn clipboard(text: &str) -> Result<()> {
    if text.len() > 8 * 1024 * 1024 {
        return Err("복사할 내용이 너무 커요.".into());
    }
    let output = process::run(
        &mut Command::new("/usr/bin/pbcopy"),
        Some(text.as_bytes().to_vec()),
        Duration::from_secs(3),
        1024,
    )?;
    if output.success {
        Ok(())
    } else {
        Err("클립보드에 복사하지 못했어요.".into())
    }
}
pub fn spaces(window: &WebviewWindow) {
    let window = window.clone();
    let app = window.app_handle().clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(ptr) = window.ns_window() {
            unsafe {
                let native = &*(ptr as *const objc2_app_kit::NSWindow);
                let mut behavior = native.collectionBehavior();
                behavior |= objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary;
                behavior &= !objc2_app_kit::NSWindowCollectionBehavior::FullScreenPrimary;
                native.setCollectionBehavior(behavior);
                native.setHidesOnDeactivate(false);
            }
        }
    });
}
use tauri::Manager;
pub fn login(available: bool, change: Option<bool>) -> Result<Value> {
    use objc2_service_management::{SMAppService, SMAppServiceStatus};
    let exists = objc2::runtime::AnyClass::get(c"SMAppService").is_some();
    if !available || !exists {
        if change.is_some() {
            return Err(
                "응용 프로그램 폴더에 설치한 macOS 13 이상 앱에서 설정할 수 있어요.".into(),
            );
        }
        return Ok(
            json!({"available":false,"enabled":false,"status":"unavailable","message":"응용 프로그램 폴더에 설치한 앱에서 설정할 수 있어요. (macOS 13 이상)"}),
        );
    }
    unsafe {
        let service = SMAppService::mainAppService();
        if let Some(enabled) = change {
            let result = if enabled {
                service.registerAndReturnError()
            } else {
                service.unregisterAndReturnError()
            };
            result.map_err(|_| {
                "자동 실행 설정을 변경하지 못했어요. 시스템 설정의 로그인 항목을 확인해 주세요."
            })?;
        }
        let status = service.status();
        let enabled = matches!(
            status,
            SMAppServiceStatus::Enabled | SMAppServiceStatus::RequiresApproval
        );
        Ok(
            json!({"available":true,"enabled":enabled,"status":if status==SMAppServiceStatus::RequiresApproval{"requires-approval"}else if enabled{"enabled"}else{"disabled"},"message":if status==SMAppServiceStatus::RequiresApproval{"시스템 설정 → 일반 → 로그인 항목에서 허용해 주세요."}else if enabled{"로그인하면 BytePet이 자동으로 시작돼요."}else{"로그인할 때 자동으로 실행하지 않아요."}}),
        )
    }
}
pub fn app_info(app: &AppHandle, custom_profile: bool) -> Result<Value> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let packaged = executable
        .to_string_lossy()
        .contains(".app/Contents/MacOS/");
    let system =
        process::text(Command::new("/usr/bin/sw_vers").arg("-productVersion")).unwrap_or_default();
    Ok(
        json!({"info":{"version":format!("{} · Tauri Preview",app.package_info().version),"platform":"macOS","systemVersion":system.trim(),"arch":std::env::consts::ARCH,"packaged":packaged},"login":login(packaged&&!custom_profile&&executable.starts_with("/Applications"),None)?}),
    )
}

/// Keep the gauge above the pet without stealing keyboard focus. A separate
/// level is required: isVisible stays true when a same-level window covers it.
pub fn raise_badge(app: &AppHandle) {
    let state = app.state::<crate::state::State>();
    let visible = state.ui.lock().unwrap().visible;
    let prefs = state.usage.lock().unwrap().preferences.clone();
    if !visible
        || prefs["badgeMode"] == "hidden"
        || (prefs["codex"] != true && prefs["claude"] != true)
    {
        return;
    }
    let Some(badge) = app.get_webview_window("badge") else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        if let Ok(ptr) = badge.ns_window() {
            unsafe {
                let window = &*(ptr as *const objc2_app_kit::NSWindow);
                window.setHidesOnDeactivate(false);
                window.setLevel(6); // Floating pet/menu are at level 5.
                window.orderFrontRegardless();
            }
        }
    });
}
#[cfg(debug_assertions)]
pub fn badge_state(app: &AppHandle) -> Value {
    let Some(badge) = app.get_webview_window("badge") else {
        return Value::Null;
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let _=app.run_on_main_thread(move||{
        let value=if let Ok(ptr)=badge.ns_window(){unsafe{let w=&*(ptr as *const objc2_app_kit::NSWindow);json!({"visible":w.isVisible(),"level":w.level(),"hidesOnDeactivate":w.hidesOnDeactivate()})}}else{Value::Null};
        let _=tx.send(value);
    });
    rx.recv_timeout(Duration::from_secs(2))
        .unwrap_or(Value::Null)
}
