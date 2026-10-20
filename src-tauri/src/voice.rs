use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct SpeechControl {
    generation: u64,
    request: Option<CancellationToken>,
}

#[derive(Default)]
pub struct VoiceState {
    pub listener: Mutex<Option<Child>>,
    pub speaker: Mutex<Option<Child>>,
    pub id: AtomicU64,
    pub speech: Mutex<SpeechControl>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEvent {
    pub id: u64,
    pub kind: String,
    pub text: String,
}

fn command(mode: &str) -> Result<Command, String> {
    if !cfg!(windows) {
        return Err("Local voice in CoCo 0.1 requires Windows.".into());
    }
    let script = include_str!("../native/voice.ps1");
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let mut cmd = Command::new(format!(
        "{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    ));
    cmd.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        &STANDARD.encode(bytes),
    ])
    .env("COCO_VOICE_MODE", mode)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    super::hide_console(&mut cmd);
    Ok(cmd)
}

pub fn probe() -> Result<serde_json::Value, String> {
    let output = command("probe")?
        .output()
        .map_err(|_| "Windows speech is unavailable.".to_string())?;
    if !output.status.success() {
        return Err("Install a Windows speech language to enable local voice.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Could not read installed Windows speech languages.".into())
}

pub fn start(app: tauri::AppHandle) -> Result<u64, String> {
    let state = app.state::<VoiceState>();
    stop_speaker(&state);
    let mut listener = state.listener.lock().unwrap();
    if listener.is_some() {
        return Err("Voice input is already active.".into());
    }
    let id = state.id.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = command("listen")?
        .spawn()
        .map_err(|_| "Could not start Windows speech recognition.".to_string())?;
    let stdout = child.stdout.take().ok_or("Could not read speech output.")?;
    *listener = Some(child);
    drop(listener);
    std::thread::spawn(move || {
        let mut terminal = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                let kind = value["kind"].as_str().unwrap_or("").to_owned();
                if kind.is_empty() {
                    continue;
                }
                terminal |= kind == "result" || kind == "error";
                let _ = app.emit(
                    "voice-event",
                    VoiceEvent {
                        id,
                        kind,
                        text: value["text"].as_str().unwrap_or_default().into(),
                    },
                );
            }
        }
        let state = app.state::<VoiceState>();
        if state.id.load(Ordering::SeqCst) == id {
            if let Some(mut child) = state.listener.lock().unwrap().take() {
                let _ = child.wait();
            }
            if !terminal {
                let _ = app.emit("voice-event", VoiceEvent { id, kind:"error".into(), text:"Speech recognition ended unexpectedly. Check your microphone and language pack.".into() });
            }
        }
    });
    Ok(id)
}

pub fn stop_listener(state: &VoiceState, cancel: bool) {
    let mut listener = state.listener.lock().unwrap();
    if cancel {
        state.id.fetch_add(1, Ordering::SeqCst);
        if let Some(mut child) = listener.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    } else if let Some(child) = listener.as_mut() {
        if let Some(input) = child.stdin.as_mut() {
            let _ = input.write_all(b"\n");
        }
    }
}

pub fn stop_speaker(state: &VoiceState) {
    let mut control = state.speech.lock().unwrap();
    control.generation += 1;
    if let Some(token) = control.request.take() {
        token.cancel();
    }
    if let Some(mut child) = state.speaker.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn speak(state: &VoiceState, text: &str) -> Result<(), String> {
    if state.listener.lock().unwrap().is_some() {
        return Ok(());
    }
    let mut child = command("speak")?
        .spawn()
        .map_err(|_| "Could not start Windows speech output.".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(
                format!(
                    "{}\n",
                    crate::repository::clip(&text.replace(['\r', '\n'], " "), 4000)
                )
                .as_bytes(),
            )
            .map_err(|_| "Speech output could not start.".to_string())?;
    }
    *state.speaker.lock().unwrap() = Some(child);
    Ok(())
}

pub async fn speak_selected(
    app: tauri::AppHandle,
    text: String,
    options: crate::tts::Options,
    key: Option<String>,
) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    let (generation, token) = {
        let mut control = state.speech.lock().unwrap();
        // Replace the old request and register the new one under one lock so
        // concurrent replay/Stop calls cannot start untracked playback later.
        control.generation += 1;
        if let Some(previous) = control.request.take() {
            previous.cancel();
        }
        if let Some(mut child) = state.speaker.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let token = CancellationToken::new();
        control.request = Some(token.clone());
        (control.generation, token)
    };
    let text = crate::repository::redact(&text);
    let audio = if options.provider == "openai" {
        Some(tokio::select! {
            biased;
            _ = token.cancelled() => return Ok(()),
            result = crate::tts::generate(&text,key.as_deref().unwrap_or(""),&options) => result?,
        })
    } else {
        None
    };
    let (mut input, audio) = {
        let control = state.speech.lock().unwrap();
        if control.generation != generation || token.is_cancelled() {
            return Ok(());
        }
        if state.listener.lock().unwrap().is_some() {
            return Ok(());
        }
        if let Some(audio) = audio {
            let mut child = command("audio")?
                .spawn()
                .map_err(|_| "Could not start audio playback.")?;
            // A pipe write can block; the process is registered first so Stop can kill it.
            let input = child.stdin.take().ok_or("Could not write speech audio.")?;
            *state.speaker.lock().unwrap() = Some(child);
            (input, audio)
        } else {
            return speak(&state, &text);
        }
    };
    let written = tauri::async_runtime::spawn_blocking(move || {
        input.write_all(format!("{}\n", STANDARD.encode(audio)).as_bytes())
    })
    .await
    .map_err(|_| "Speech playback worker failed.")?;
    if token.is_cancelled() {
        return Ok(());
    }
    written.map_err(|_| "Speech playback could not start.")?;
    loop {
        {
            let control = state.speech.lock().unwrap();
            if control.generation != generation || token.is_cancelled() {
                return Ok(());
            }
            let mut speaker = state.speaker.lock().unwrap();
            let Some(child) = speaker.as_mut() else {
                return Ok(());
            };
            if let Some(status) = child
                .try_wait()
                .map_err(|_| "Could not check speech playback.")?
            {
                speaker.take();
                return if status.success() {
                    Ok(())
                } else {
                    Err(
                        "Speech playback failed. Check your audio device or choose Windows speech."
                            .into(),
                    )
                };
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopping_speech_cancels_pending_generation() {
        let state = VoiceState::default();
        let token = CancellationToken::new();
        state.speech.lock().unwrap().request = Some(token.clone());
        stop_speaker(&state);
        assert!(token.is_cancelled());
        assert_eq!(state.speech.lock().unwrap().generation, 1);
    }
    #[test]
    #[ignore = "requires installed Windows speech resources"]
    fn native_speech_loopback() {
        let output = command("selftest").unwrap().output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("check the code"));
    }
}
