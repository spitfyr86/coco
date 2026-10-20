use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub provider: String,
    pub voice: String,
    pub speed: f32,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            provider: "windows".into(),
            voice: "marin".into(),
            speed: 1.0,
        }
    }
}
pub fn validate(options: &Options) -> Result<(), String> {
    if !matches!(options.provider.as_str(), "windows" | "openai")
        || ![
            "marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx",
            "sage", "shimmer", "verse",
        ]
        .contains(&options.voice.as_str())
        || !options.speed.is_finite()
        || !(0.75..=1.25).contains(&options.speed)
    {
        return Err("Invalid speech provider, voice, or speed.".into());
    }
    Ok(())
}
pub async fn generate(text: &str, key: &str, options: &Options) -> Result<Vec<u8>, String> {
    generate_at("https://api.openai.com/v1/audio/speech", text, key, options).await
}
async fn generate_at(
    url: &str,
    text: &str,
    key: &str,
    options: &Options,
) -> Result<Vec<u8>, String> {
    validate(options)?;
    if key.trim().is_empty() {
        return Err("Add an OpenAI API key in Settings to use OpenAI speech.".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|_| "Could not start speech generation.")?;
    let mut response = client.post(url).bearer_auth(key).json(&serde_json::json!({
        "model":"gpt-4o-mini-tts", "voice":options.voice, "speed":options.speed,
        "input":crate::repository::clip(text,3500), "response_format":"wav",
        "instructions":"Speak as a calm, clear coding coach. Use a natural conversational tone and brief pauses between steps."
    })).send().await.map_err(|_| "OpenAI speech could not connect or timed out. Try again or choose Windows speech.")?;
    if !response.status().is_success() {
        return Err(format!("OpenAI speech returned HTTP {}. Check API access, credit, and limits; or choose Windows speech.",response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Speech audio download failed.")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("Speech audio exceeded the size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("OpenAI speech returned invalid WAV audio.".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn rejects_redirects_provider_errors_and_non_audio() {
        for response in [
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nbad",
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/speech", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = [0; 8192];
                let _ = stream.read(&mut buf);
                stream.write_all(response.as_bytes()).unwrap();
            });
            assert!(generate_at(&url, "test", "fixture", &Options::default())
                .await
                .is_err());
            server.join().unwrap();
        }
    }
    #[test]
    fn windows_is_default_and_speech_choices_are_validated() {
        let defaults: Options = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults.provider, "windows");
        assert!(validate(&defaults).is_ok());
        assert!(validate(&Options {
            speed: f32::NAN,
            ..defaults.clone()
        })
        .is_err());
        assert!(validate(&Options {
            provider: "unknown".into(),
            ..defaults
        })
        .is_err());
    }
    #[tokio::test]
    async fn speech_payload_and_wav_are_checked_without_paid_inference() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/audio/speech", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buf[..n]);
                if let Some(pos) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&request[..pos]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|v| v.strip_prefix("content-length: "))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if request.len() >= pos + 4 + length {
                        break;
                    }
                }
            }
            let payload = String::from_utf8_lossy(&request);
            assert!(payload.contains("gpt-4o-mini-tts"));
            assert!(payload.contains("cedar"));
            assert!(payload.contains("response_format"));
            let wav = b"RIFFxxxxWAVEfixture";
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                wav.len()
            )
            .unwrap();
            stream.write_all(wav).unwrap();
        });
        let audio = generate_at(
            &url,
            "Fixture speech",
            "fixture-key",
            &Options {
                provider: "openai".into(),
                voice: "cedar".into(),
                speed: 1.0,
            },
        )
        .await
        .unwrap();
        assert!(audio.starts_with(b"RIFF"));
        server.join().unwrap();
    }
}
