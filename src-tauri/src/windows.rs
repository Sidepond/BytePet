use crate::{
    layout::{self, Rect},
    state::State,
    store::{read_json, write_json, Result},
};
use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
pub fn bounds(w: &WebviewWindow) -> Option<Rect> {
    let scale = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?.to_logical::<f64>(scale);
    let size = w.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Rect {
        x: p.x,
        y: p.y,
        width: size.width,
        height: size.height,
    })
}
pub fn areas(app: &AppHandle) -> Vec<Rect> {
    let mut monitors = app.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = app.primary_monitor() {
        if let Some(index) = monitors
            .iter()
            .position(|m| m.position() == primary.position())
        {
            monitors.swap(0, index);
        }
    }
    let areas: Vec<_> = monitors
        .iter()
        .map(|m| {
            let a = m.work_area();
            let scale = m.scale_factor();
            Rect {
                x: a.position.x as f64 / scale,
                y: a.position.y as f64 / scale,
                width: a.size.width as f64 / scale,
                height: a.size.height as f64 / scale,
            }
        })
        .collect();
    if areas.is_empty() {
        vec![Rect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
        }]
    } else {
        areas
    }
}
pub fn set(w: &WebviewWindow, r: Rect) {
    if let Some(old) = bounds(w) {
        if old.width != r.width || old.height != r.height {
            let _ = w.set_size(LogicalSize::new(r.width.round(), r.height.round()));
        }
        if old.x != r.x.round() || old.y != r.y.round() {
            let _ = w.set_position(LogicalPosition::new(r.x.round(), r.y.round()));
        }
    }
}
fn create(
    app: &AppHandle,
    label: &str,
    file: &str,
    title: &str,
    rect: Rect,
) -> tauri::Result<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(file.into()))
        .title(title)
        .inner_size(rect.width, rect.height)
        .position(rect.x, rect.y)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .fullscreen(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .disable_drag_drop_handler()
        .visible(false)
        .focused(false)
        .skip_taskbar(label != "pet")
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"));
    if label == "panel" {
        if let Some(parent) = app.get_webview_window("pet") {
            builder = builder.parent(&parent)?;
        }
    }
    let w = builder.build()?;
    crate::native::spaces(&w);
    Ok(w)
}
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<State>();
    let settings = state.settings.lock().unwrap();
    let ground = settings.appearance["ground"] == true;
    drop(settings);
    let areas = areas(app);
    let mut rect = layout::initial(areas[0], ground);
    if let Ok(v) = read_json(&state.root.join("pet-position.json"), 16384) {
        if let (Some(x), Some(y)) = (v["x"].as_f64(), v["y"].as_f64()) {
            if x.abs() <= 1e6 && y.abs() <= 1e6 {
                rect.x = x;
                rect.y = y;
                rect = rect.clamp(layout::nearest(rect, &areas));
            }
        }
    }
    let pet = create(app, "pet", "pet.html", "BytePet Tauri", rect)?;
    let panel = create(
        app,
        "panel",
        "panel.html",
        "BytePet Tauri 메뉴",
        Rect {
            width: 360.0,
            height: 588.0,
            ..rect
        },
    )?;
    let badge = create(
        app,
        "badge",
        "usage-badge.html",
        "BytePet Tauri 사용량",
        Rect {
            width: 120.0,
            height: 24.0,
            ..rect
        },
    )?;
    let _ = badge.set_focusable(false);
    let handle = app.clone();
    panel.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            close(&handle);
        }
    });
    let handle = app.clone();
    pet.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            handle.exit(0);
        }
    });
    for window in [&pet, &panel] {
        let handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Focused(_)) {
                crate::native::raise_badge(&handle);
            }
        });
    }
    pet.show()?;
    reposition(app);
    Ok(())
}
pub fn reposition(app: &AppHandle) {
    let state = app.state::<State>();
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };
    let Some(mut rect) = bounds(&pet) else { return };
    let settings = state.settings.lock().unwrap();
    let (ground, left) = (
        settings.appearance["ground"] == true,
        settings.appearance["menuSide"] == "left",
    );
    drop(settings);
    let ui = state.ui.lock().unwrap();
    let (open, visible, region) = (ui.panel_open, ui.visible, ui.region.clone());
    drop(ui);
    let areas = areas(app);
    let area = layout::nearest(rect, &areas);
    rect.width = if ground { 496.0f64 } else { 128.0 }.min(area.width);
    rect.height = 128.0f64.min(area.height);
    rect = rect.clamp(area);
    if open {
        rect = layout::yard_for_panel(rect, area, ground, left);
    }
    set(&pet, rect);
    if let Some(panel) = app.get_webview_window("panel") {
        set(&panel, layout::panel(rect, area, ground, left));
        if !open && panel.is_visible().unwrap_or(false) {
            let _ = panel.hide();
        }
    }
    let usage = state.usage.lock().unwrap();
    let prefs = usage.preferences.clone();
    drop(usage);
    let rows = usize::from(prefs["codex"] == true) + usize::from(prefs["claude"] == true);
    if let Some(badge) = app.get_webview_window("badge") {
        if !visible || rows == 0 || prefs["badgeMode"] == "hidden" {
            let _ = badge.hide();
        } else {
            set(
                &badge,
                layout::badge(
                    rect,
                    area,
                    ground,
                    left,
                    prefs["badgePosition"].as_str().unwrap_or("ground"),
                    rows,
                    &region,
                ),
            );
            if !badge.is_visible().unwrap_or(false) {
                let _ = badge.show();
            }
            crate::native::raise_badge(app);
        }
    }
}
pub fn open(app: &AppHandle, view: Option<&str>) {
    let state = app.state::<State>();
    {
        let mut ui = state.ui.lock().unwrap();
        ui.panel_open = true;
        ui.visible = true;
        ui.pending_view = view.map(str::to_string);
    }
    if let Some(p) = app.get_webview_window("pet") {
        let _ = p.show();
    }
    reposition(app);
    let ready = state.ui.lock().unwrap().panel_ready;
    if ready {
        show_panel(app);
    }
    let _ = app.emit("pet:panel-state", true);
    let _ = app.emit("pet:visibility", true);
}
pub fn show_panel(app: &AppHandle) {
    if let Some(p) = app.get_webview_window("panel") {
        let state = app.state::<State>();
        let view = {
            let mut ui = state.ui.lock().unwrap();
            if !ui.panel_open {
                return;
            }
            ui.pending_view.take()
        };
        let _ = p.show();
        let _ = p.set_focus();
        let _ = p.emit("panel:opened", view);
        crate::native::raise_badge(app);
    }
}
pub fn close(app: &AppHandle) {
    let state = app.state::<State>();
    state.ui.lock().unwrap().panel_open = false;
    if let Some(p) = app.get_webview_window("panel") {
        let _ = p.hide();
    }
    let _ = app.emit("pet:panel-state", false);
    crate::native::raise_badge(app);
}
pub fn visibility(app: &AppHandle, visible: bool) {
    let state = app.state::<State>();
    state.ui.lock().unwrap().visible = visible;
    if let Some(p) = app.get_webview_window("pet") {
        if visible {
            let _ = p.show();
        } else {
            close(app);
            let _ = p.hide();
        }
    }
    let _ = app.emit("pet:visibility", visible);
    reposition(app);
}
pub fn save_position(app: &AppHandle) -> Result<()> {
    if let Some(rect) = app.get_webview_window("pet").and_then(|w| bounds(&w)) {
        write_json(
            &app.state::<State>().root.join("pet-position.json"),
            &json!({"version":1,"x":rect.x.round(),"y":rect.y.round()}),
        )?;
    }
    Ok(())
}
pub fn reset(app: &AppHandle) {
    let state = app.state::<State>();
    state.ui.lock().unwrap().dragging = None;
    let ground = state.settings.lock().unwrap().appearance["ground"] == true;
    if let Some(p) = app.get_webview_window("pet") {
        set(&p, layout::initial(areas(app)[0], ground));
    }
    let _ = app.emit("pet:position-reset", ());
    visibility(app, true);
    let _ = save_position(app);
}
pub fn drag(app: &AppHandle, phase: &str, point: &Value) -> Result<()> {
    let state = app.state::<State>();
    let pet = app
        .get_webview_window("pet")
        .ok_or("캐릭터 창을 찾지 못했어요.")?;
    if phase == "end" {
        state.ui.lock().unwrap().dragging = None;
        reposition(app);
        save_position(app)?;
        return Ok(());
    }
    let (x, y) = (
        point["x"].as_f64().ok_or("잘못된 위치")?,
        point["y"].as_f64().ok_or("잘못된 위치")?,
    );
    if x.abs() > 1e6 || y.abs() > 1e6 {
        return Err("잘못된 위치".into());
    }
    match phase {
        "start" => {
            let rect = bounds(&pet).ok_or("잘못된 창 위치")?;
            state.ui.lock().unwrap().dragging = Some((x, y, rect));
            let _ = pet.set_ignore_cursor_events(false);
        }
        "move" => {
            let gesture = state.ui.lock().unwrap().dragging;
            if let Some((start_x, start_y, mut rect)) = gesture {
                rect.x += x - start_x;
                rect.y += y - start_y;
                set(&pet, rect);
                reposition(app);
            }
        }
        _ => return Err("잘못된 드래그 요청".into()),
    }
    Ok(())
}
pub fn input_tick(app: &AppHandle) {
    let state = app.state::<State>();
    let ui = state.ui.lock().unwrap();
    if !ui.visible {
        return;
    }
    let (region, dragging, old) = (
        ui.region.clone(),
        ui.dragging.is_some() || ui.context_menu,
        ui.ignoring,
    );
    drop(ui);
    let Some(p) = app.get_webview_window("pet") else {
        return;
    };
    let (Some(rect), Ok(cursor), Ok(scale)) = (
        bounds(&p),
        p.cursor_position(),
        app.primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .ok_or(()),
    ) else {
        return;
    };
    let cursor = cursor.to_logical::<f64>(scale);
    let (x, y) = (cursor.x - rect.x, cursor.y - rect.y);
    let ground = state.settings.lock().unwrap().appearance["ground"] == true;
    let hit_ground = ground
        && x >= 8.0
        && x < rect.width - 8.0
        && y >= rect.height - 20.0
        && y < rect.height - 4.0;
    let ignore = !(dragging || layout::hit(&region, x, y) || hit_ground);
    if old != Some(ignore) && p.set_ignore_cursor_events(ignore).is_ok() {
        state.ui.lock().unwrap().ignoring = Some(ignore);
    }
}
