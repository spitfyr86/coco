mod capture;
mod models;
mod progress;
mod provider;
mod references;
mod repository;
mod sessions;
mod tray;
mod tts;
mod voice;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    process::Command,
    sync::{atomic::Ordering, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};
use tokio_util::sync::CancellationToken;

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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    provider: String,
    model: String,
    reasoning_effort: String,
    local_url: String,
    theme: String,
    text_size: u16,
    speak_answers: bool,
    speech: tts::Options,
    has_api_key: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "ollama".into(),
            model: String::new(),
            reasoning_effort: "auto".into(),
            local_url: "http://127.0.0.1:11434".into(),
            theme: "system".into(),
            text_size: 100,
            speak_answers: true,
            speech: tts::Options::default(),
            has_api_key: false,
        }
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    repository: Option<repository::RepoReport>,
    screen: Option<capture::Screen>,
    captured_at: Option<u64>,
    number: u64,
}
#[derive(Default)]
struct Session {
    root: Option<String>,
    checkpoint: Option<repository::Checkpoint>,
    context: Context,
    messages: Vec<provider::Message>,
    usage: provider::Usage,
}
#[derive(Default)]
struct State {
    settings: Mutex<Settings>,
    sessions: sessions::Manager,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("CoCo", "openai-api-key")
        .map_err(|_| "Windows Credential Manager is unavailable.".into())
}
fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}
fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = std::env::var_os("COCO_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(app.path().app_config_dir().map_err(|e| e.to_string())?);
    if !dir.is_absolute() {
        return Err("COCO_DATA_DIR must be an absolute directory.".into());
    }
    Ok(dir)
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle, state: tauri::State<State>) -> Result<Settings, String> {
    let settings = config_path(&app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .unwrap_or_default();
    let mut settings = settings;
    settings.has_api_key = key_entry()
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some();
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<State>,
    mut settings: Settings,
    api_key: Option<String>,
    clear_key: bool,
) -> Result<Settings, String> {
    if !matches!(settings.provider.as_str(), "ollama" | "openai")
        || !matches!(settings.theme.as_str(), "light" | "dark" | "system")
    {
        return Err("Invalid provider or theme.".into());
    }
    if settings.provider == "ollama" {
        settings.local_url = provider::valid_local_url(&settings.local_url)?;
    }
    if settings.model.len() > 150 {
        return Err("Model name is too long.".into());
    }
    provider::validate_effort(&settings)?;
    if !(85..=150).contains(&settings.text_size) {
        return Err("Text size must be between 85% and 150%.".into());
    }
    tts::validate(&settings.speech)?;
    let entry = key_entry()?;
    if clear_key {
        let _ = entry.delete_credential();
    }
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        entry
            .set_password(key.trim())
            .map_err(|_| "Could not save the key in Windows Credential Manager.".to_string())?;
    }
    settings.has_api_key = entry.get_password().is_ok();
    let path = config_path(&app)?;
    fs::write(
        path,
        serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
async fn pick_repository(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    session_id: Option<String>,
) -> Result<Option<String>, String> {
    let id = state.sessions.id(session_id.as_deref())?;
    let runtime = state.sessions.runtime(Some(&id))?;
    if runtime.request.lock().unwrap().is_some() {
        return Err("Stop the current request before changing repositories.".into());
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Select a code repository")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let mut session = runtime.session.lock().unwrap();
    if session.root.as_ref() != Some(&path) {
        session.root = Some(path.clone());
        session.checkpoint = None;
        session.context = Context::default();

        runtime.epoch.fetch_add(1, Ordering::SeqCst);
    }
    drop(session);
    state.sessions.persist_runtime(&id)?;
    Ok(Some(path))
}

#[tauri::command]
fn detach_repository(state: tauri::State<State>, session_id: Option<String>) -> Result<(), String> {
    let id = state.sessions.id(session_id.as_deref())?;
    let runtime = state.sessions.runtime(Some(&id))?;
    if runtime.request.lock().unwrap().is_some() {
        return Err("Stop the current request first.".into());
    }
    let mut session = runtime.session.lock().unwrap();
    session.root = None;
    session.checkpoint = None;
    session.context = Context::default();
    drop(session);
    runtime.epoch.fetch_add(1, Ordering::SeqCst);
    state.sessions.persist_runtime(&id)?;
    Ok(())
}

#[tauri::command]
async fn list_models(
    provider: String,
    local_url: String,
    api_key: Option<String>,
    clear_key: bool,
) -> Result<Vec<models::Model>, String> {
    let key = if provider == "openai" {
        api_key.filter(|k| !k.trim().is_empty()).or_else(|| {
            if clear_key {
                None
            } else {
                key_entry().ok().and_then(|e| e.get_password().ok())
            }
        })
    } else {
        None
    };
    models::list(&provider, &local_url, key).await
}

#[tauri::command]
async fn list_sources() -> Result<Vec<capture::Source>, String> {
    tauri::async_runtime::spawn_blocking(capture::sources)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_context(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    goal: String,
    query: String,
    source_id: Option<String>,
    include_repository: bool,
    session_id: Option<String>,
) -> Result<Context, String> {
    let id = state.sessions.id(session_id.as_deref())?;
    let runtime = state.sessions.runtime(Some(&id))?;
    let _capture_guard = state.sessions.begin_capture()?;
    if runtime.request.lock().unwrap().is_some() {
        return Err("Stop the current request before refreshing context.".into());
    }
    let epoch = runtime.epoch.load(Ordering::SeqCst);
    let (root, previous) = {
        let session = runtime.session.lock().unwrap();
        (session.root.clone(), session.checkpoint.clone())
    };
    let window = app.get_webview_window("main");
    let restore_window = source_id.is_some()
        && window
            .as_ref()
            .is_some_and(|w| w.is_visible().unwrap_or(false));
    if source_id.is_some() {
        if let Some(w) = &window {
            w.hide().map_err(|e| e.to_string())?;
        }
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
    }
    // Hide only for the screenshot, never for repository traversal or inference.
    // Restore before propagating capture errors (including a stalled worker).
    let screen_result = if let Some(source) = source_id {
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            tauri::async_runtime::spawn_blocking(move || capture::capture(&source)),
        )
        .await
        {
            Ok(result) => result.map_err(|e| e.to_string()).and_then(|v| v),
            Err(_) => Err(
                "Screen capture timed out. Try another source or turn screen capture off.".into(),
            ),
        }
        .map(Some)
    } else {
        Ok(None)
    };
    if restore_window && tray::wants_visible(&app) {
        if let Some(w) = &window {
            w.show().map_err(|_| {
                "Could not restore CoCo after capture. Use Show CoCo in the system tray."
            })?;
        }
    }
    let screen = screen_result?;
    let checkpoint = tauri::async_runtime::spawn_blocking(move || {
        if include_repository {
            root.map(|root| repository::scan(&root, previous.as_ref(), &format!("{goal} {query}")))
                .transpose()
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    if runtime.epoch.load(Ordering::SeqCst) != epoch {
        return Err("The session changed during capture. Capture again.".into());
    }
    let mut session = runtime.session.lock().unwrap();
    let context = Context {
        screen,
        repository: checkpoint.as_ref().map(|p| p.report.clone()),
        captured_at: Some(now()),
        number: session
            .context
            .number
            .max(state.sessions.last_checkpoint(&id))
            + 1,
    };
    if let Some(checkpoint) = checkpoint {
        session.checkpoint = Some(checkpoint);
    }
    session.context = context.clone();
    drop(session);
    state.sessions.persist_runtime(&id)?;
    Ok(context)
}

#[tauri::command]
async fn ask_coach(
    state: tauri::State<'_, State>,
    goal: String,
    question: String,
    use_screen: bool,
    use_repository: bool,
    session_id: Option<String>,
    assessment_checkpoint: Option<u64>,
) -> Result<SessionAnswer, String> {
    let id = state.sessions.id(session_id.as_deref())?;
    let runtime = state.sessions.runtime(Some(&id))?;
    if goal.trim().is_empty() {
        return Err("Set a session goal first.".into());
    }
    if goal.len() > 8000 || question.len() > 24_000 {
        return Err("Shorten the goal or question before sending.".into());
    }
    let cancellation = CancellationToken::new();
    {
        let mut active = runtime.request.lock().unwrap();
        if active.is_some() {
            return Err("A coaching request is already running.".into());
        }
        state.sessions.prepare_question(&id, &goal, &question)?;
        *active = Some(cancellation.clone());
    }
    let epoch = runtime.epoch.load(Ordering::SeqCst);
    let settings = state.settings.lock().unwrap().clone();
    let (context, history) = {
        let session = runtime.session.lock().unwrap();
        (session.context.clone(), session.messages.clone())
    };
    let mut context_text = provider::context_text(
        &goal,
        if use_repository {
            context.repository.as_ref()
        } else {
            None
        },
        context.number,
        context.captured_at,
        use_screen && context.screen.is_some(),
    );
    context_text.push_str(&state.sessions.progress_context(&id));
    context_text.push_str(&references::context_text(
        &runtime.references.lock().unwrap(),
    ));
    let snapshot = if assessment_checkpoint.is_some_and(|n| n == context.number)
        || state.sessions.progress_needs_plan(&id)
    {
        state.sessions.progress_snapshot(&id, context.number)
    } else {
        None
    };
    if let Some(plan) = &snapshot {
        context_text.push_str(&progress::plan(plan));
    }
    let key = if settings.provider == "openai" {
        key_entry().ok().and_then(|e| e.get_password().ok())
    } else {
        None
    };
    let image = if use_screen {
        context.screen.as_ref().map(|s| s.data_url.as_str())
    } else {
        None
    };
    let mut result = tokio::select! { biased;
        _ = cancellation.cancelled() => Err("Request cancelled.".to_string()),
        answer = provider::ask(&settings,key,&context_text,&history,&question,image,snapshot.is_some()) => answer,
    };
    if runtime.epoch.load(Ordering::SeqCst) != epoch {
        *runtime.request.lock().unwrap() = None;
        return Err("The session changed. The previous response was discarded.".into());
    }
    let attempt = if let (Some(snapshot), Ok(answer)) = (snapshot, &mut result) {
        let (guidance, updates, warning) = progress::parse(&answer.text);
        answer.text = guidance;
        Some(progress::Attempt {
            snapshot,
            updates,
            warning,
        })
    } else {
        None
    };
    if let Ok(answer) = &result {
        let mut session = runtime.session.lock().unwrap();
        session.messages.push(provider::Message {
            role: "user".into(),
            text: repository::redact(&question),
        });
        session.messages.push(provider::Message {
            role: "assistant".into(),
            text: answer.text.clone(),
        });
        if session.messages.len() > 24 {
            let excess = session.messages.len() - 24;
            session.messages.drain(..excess);
        }
        session.usage.requests += 1;
        session.usage.input_tokens += answer.usage.input_tokens;
        session.usage.output_tokens += answer.usage.output_tokens;
    }
    let reply = result.map(|answer| {
        let completed = state
            .sessions
            .complete(&id, &question, &answer, context.number, attempt);
        let save_error = completed.as_ref().err().cloned();
        let messages = completed.unwrap_or_else(|_| {
            state
                .sessions
                .view(&id)
                .map(|v| v.document.messages)
                .unwrap_or_default()
        });
        SessionAnswer {
            answer,
            messages,
            save_error,
            progress: state.sessions.progress_state(&id),
        }
    });
    *runtime.request.lock().unwrap() = None;
    reply
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionAnswer {
    #[serde(flatten)]
    answer: provider::Answer,
    messages: Vec<sessions::ChatMessage>,
    save_error: Option<String>,
    progress: Option<progress::State>,
}

#[tauri::command]
fn cancel_request(state: tauri::State<State>, session_id: Option<String>) -> Result<(), String> {
    let runtime = state.sessions.runtime(session_id.as_deref())?;
    if let Some(token) = runtime.request.lock().unwrap().as_ref() {
        token.cancel();
    }
    Ok(())
}
#[tauri::command]
fn reset_session(
    state: tauri::State<State>,
    voice_state: tauri::State<voice::VoiceState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let id = state.sessions.id(session_id.as_deref())?;
    let runtime = state.sessions.runtime(Some(&id))?;
    if let Some(token) = runtime.request.lock().unwrap().as_ref() {
        token.cancel();
    }
    runtime.epoch.fetch_add(1, Ordering::SeqCst);
    runtime.references.lock().unwrap().clear();
    let mut session = runtime.session.lock().unwrap();
    let root = session.root.clone();
    *session = Session {
        root,
        ..Default::default()
    };
    voice::stop_listener(&voice_state, true);
    voice::stop_speaker(&voice_state);
    drop(session);
    state.sessions.clear_legacy(&id)?;
    Ok(())
}
#[tauri::command]
async fn voice_status() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(voice::probe)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn start_voice(app: tauri::AppHandle) -> Result<u64, String> {
    voice::start(app)
}
#[tauri::command]
fn stop_voice(state: tauri::State<voice::VoiceState>, cancel: bool) {
    voice::stop_listener(&state, cancel);
}
#[tauri::command]
async fn speak(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    text: String,
    speech: Option<tts::Options>,
    api_key: Option<String>,
) -> Result<(), String> {
    let options = speech.unwrap_or_else(|| state.settings.lock().unwrap().speech.clone());
    tts::validate(&options)?;
    let key = if options.provider == "openai" {
        api_key
            .filter(|v| !v.trim().is_empty())
            .or_else(|| key_entry().ok().and_then(|e| e.get_password().ok()))
    } else {
        None
    };
    voice::speak_selected(app, text, options, key).await
}
#[tauri::command]
fn stop_speaking(state: tauri::State<voice::VoiceState>) {
    voice::stop_speaker(&state);
}

fn stop_workers(app: &tauri::AppHandle) {
    let state = app.state::<State>();
    state.sessions.stop_all();
    let voice = app.state::<voice::VoiceState>();
    voice::stop_listener(&voice, true);
    voice::stop_speaker(&voice);
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(State::default())
        .manage(voice::VoiceState::default())
        .manage(tray::Lifecycle::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let action = if shortcut.key == Code::Space {
                        "voice"
                    } else {
                        "capture"
                    };
                    let _ = app.emit("coco-shortcut", action);
                })
                .build(),
        )
        .setup(|app| {
            app.state::<State>()
                .sessions
                .initialize(
                    data_dir(app.handle())
                        .map_err(std::io::Error::other)?
                        .join("sessions"),
                )
                .map_err(std::io::Error::other)?;
            tray::setup(app)?;
            // Conflicts are visible in the UI instead of silently disabling shortcuts.
            let shortcuts = [
                "CommandOrControl+Shift+Enter",
                "CommandOrControl+Shift+Space",
            ];
            let failures: Vec<_> = shortcuts
                .iter()
                .filter(|s| app.global_shortcut().register(**s).is_err())
                .map(|s| s.to_string())
                .collect();
            if !failures.is_empty() {
                app.manage(ShortcutWarnings(failures));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            sessions::load_workspace,
            sessions::get_session,
            sessions::save_session_form,
            sessions::undo_progress,
            sessions::session_action,
            sessions::import_session,
            save_settings,
            pick_repository,
            detach_repository,
            list_sources,
            list_models,
            references::list_references,
            references::add_reference,
            references::pick_reference,
            references::update_reference,
            refresh_context,
            ask_coach,
            cancel_request,
            reset_session,
            voice_status,
            start_voice,
            stop_voice,
            speak,
            stop_speaking,
            shortcut_warnings
        ])
        .build(tauri::generate_context!())
        .expect("Could not start CoCo");
    app.run(tray::on_event);
}
struct ShortcutWarnings(Vec<String>);
#[tauri::command]
fn shortcut_warnings(app: tauri::AppHandle) -> Vec<String> {
    app.try_state::<ShortcutWarnings>()
        .map(|s| s.0.clone())
        .unwrap_or_default()
}
