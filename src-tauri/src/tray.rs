use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub struct Lifecycle {
    visible: AtomicBool,
    exiting: AtomicBool,
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            visible: AtomicBool::new(true),
            exiting: AtomicBool::new(false),
        }
    }
}

pub fn wants_visible(app: &AppHandle) -> bool {
    app.state::<Lifecycle>().visible.load(Ordering::SeqCst)
}

fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        app.state::<Lifecycle>()
            .visible
            .store(true, Ordering::SeqCst);
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide()?;
        app.state::<Lifecycle>()
            .visible
            .store(false, Ordering::SeqCst);
    }
    Ok(())
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show CoCo", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide CoCo", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &exit])?;
    let icon = app
        .default_window_icon()
        .ok_or("CoCo's tray icon is missing")?;
    TrayIconBuilder::with_id("coco")
        .icon(icon.clone())
        .tooltip("CoCo · Code Coach")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "show" => self::show(app),
                "hide" => self::hide(app),
                "exit" => {
                    app.state::<Lifecycle>()
                        .exiting
                        .store(true, Ordering::SeqCst);
                    crate::stop_workers(app);
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };
            if result.is_err() {
                eprintln!("Could not change CoCo window visibility from the tray.");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = self::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn on_event(app: &AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if hide(app).is_err() {
                eprintln!("Could not hide CoCo. Use the tray Exit action to quit.");
            }
        }
        tauri::RunEvent::ExitRequested { api, .. }
            if !app.state::<Lifecycle>().exiting.load(Ordering::SeqCst) =>
        {
            api.prevent_exit();
        }
        tauri::RunEvent::Exit => crate::stop_workers(app),
        _ => {}
    }
}
