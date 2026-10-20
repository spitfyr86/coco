pub mod capture;
pub mod repository;
pub mod models;
pub mod provider;
use std::process::Command;
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

#[derive(Clone,serde::Serialize,serde::Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Settings {pub provider:String,pub model:String,pub reasoning_effort:String,pub local_url:String,
}
impl Default for Settings {fn default()->Self {Self {provider:"ollama".into(),model:String::new(),reasoning_effort:"auto".into(),local_url:"http://127.0.0.1:11434".into(),}}}
pub fn run() {
 tauri::Builder::default().plugin(tauri_plugin_dialog::init()).run(tauri::generate_context!()).expect("Could not start CoCo");
}
