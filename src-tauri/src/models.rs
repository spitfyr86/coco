use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub completion: Option<bool>,
    pub vision: Option<bool>,
    pub rank: usize,
    pub size: Option<u64>,
    pub reason: String,
}

#[derive(Deserialize)]
struct Policy {
    id: String,
    reason: String,
    #[serde(default, rename = "reasoningEfforts")]
    reasoning_efforts: Vec<String>,
}

fn policy_for(id: &str) -> Option<(usize, Policy)> {
    // Verified 2026-10-18. Unknown/new IDs stay unverified rather than inheriting guessed capabilities.
    let policies: Vec<Policy> =
        serde_json::from_str(include_str!("../model-policy.json")).expect("Invalid model policy");
    policies.into_iter().enumerate().find(|(_, p)| {
        id == p.id
            || id.strip_prefix(&p.id).is_some_and(|suffix| {
                let bytes = suffix.as_bytes();
                bytes.len() == 11
                    && bytes.iter().enumerate().all(|(i, b)| {
                        if [0, 5, 8].contains(&i) {
                            *b == b'-'
                        } else {
                            b.is_ascii_digit()
                        }
                    })
            })
    })
}

pub fn reasoning_efforts(id: &str) -> Vec<String> {
    policy_for(id.trim())
        .map(|(_, p)| p.reasoning_efforts)
        .unwrap_or_default()
}

fn openai_model(id: &str) -> Model {
    let policy = policy_for(id);
    let (rank, reason, verified) =
        policy
            .map(|(i, p)| (i, p.reason, Some(true)))
            .unwrap_or((usize::MAX, String::new(), None));
    Model {
        id: id.into(),
        completion: verified,
        vision: verified,
        rank,
        size: None,
        reason,
    }
}

fn set_capabilities(model: &mut Model, value: &Value) {
    if let Some(caps) = value["capabilities"].as_array() {
        model.completion = Some(caps.iter().any(|c| c.as_str() == Some("completion")));
        model.vision = Some(caps.iter().any(|c| c.as_str() == Some("vision")));
    }
}

fn parse(provider: &str, value: &Value) -> Result<Vec<String>, String> {
    let (field, id) = if provider == "ollama" {
        ("models", "name")
    } else {
        ("data", "id")
    };
    let items = value[field]
        .as_array()
        .ok_or("The provider returned an invalid model list.")?;
    let mut models: Vec<_> = items
        .iter()
        .filter_map(|item| item[id].as_str())
        .filter(|name| {
            !name.trim().is_empty() && name.len() <= 150 && !name.chars().any(char::is_control)
        })
        .take(2000)
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn list(
    provider: &str,
    local_url: &str,
    key: Option<String>,
) -> Result<Vec<Model>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize model discovery.")?;
    let request = match provider {
        "ollama" => client.get(format!(
            "{}/api/tags",
            crate::provider::valid_local_url(local_url)?
        )),
        "openai" => client.get("https://api.openai.com/v1/models").bearer_auth(
            key.filter(|k| !k.trim().is_empty())
                .map(|k| k.trim().to_owned())
                .ok_or("Enter your OpenAI API key, then refresh models.")?,
        ),
        _ => return Err("Unknown AI provider.".into()),
    };
    let value = read_json(request).await?;
    let ids = parse(provider, &value)?;
    let mut models: Vec<_> = ids.iter().map(|id| {
        if provider == "openai" { openai_model(id) } else {
            let size = value["models"].as_array().and_then(|items| items.iter().find(|item| item["name"].as_str() == Some(id))).and_then(|item| item["size"].as_u64());
            Model { id: id.clone(), completion: None, vision: None, rank: 0, size,
                reason: "Local starting point: favors smaller compatible installed models when file size is known. Quality and speed are not benchmarked.".into() }
        }
    }).collect();
    if provider == "ollama" {
        let base = crate::provider::valid_local_url(local_url)?;
        let started = Instant::now();
        // Read metadata only: never load weights, run inference, or download models.
        for model in models.iter_mut().take(64) {
            let remaining = Duration::from_secs(12).saturating_sub(started.elapsed());
            if remaining.is_zero() {
                break;
            }
            let request = client
                .post(format!("{base}/api/show"))
                .json(&serde_json::json!({"model":model.id}));
            if let Ok(Ok(info)) =
                tokio::time::timeout(remaining.min(Duration::from_secs(3)), read_json(request))
                    .await
            {
                set_capabilities(model, &info);
            }
        }
    }
    Ok(models)
}

async fn read_json(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not load models. Check the provider connection and refresh.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => {
                "Model discovery was denied. Check your API key and its model-list permissions."
                    .into()
            }
            429 => "Model discovery is rate limited. Try again shortly.".into(),
            _ => format!(
                "Could not load models (HTTP {}).",
                response.status().as_u16()
            ),
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the model list.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("The provider's model list is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "The provider returned invalid model metadata.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn reads_provider_catalogs_without_inventing_capabilities() {
        assert_eq!(parse("ollama", &json!({"models":[{"name":"vision:latest"},{"name":"code:latest"},{"name":"vision:latest"},{"name":"bad\nname"}]})).unwrap(), vec!["code:latest", "vision:latest"]);
        assert_eq!(
            parse("openai", &json!({"data":[{"id":"available-model"}]})).unwrap(),
            vec!["available-model"]
        );
        assert!(parse("openai", &json!({"error":{"message":"private"}})).is_err());
        assert!(parse("ollama", &json!({"models":[]})).unwrap().is_empty());
    }
    #[tokio::test]
    async fn fetches_local_catalog_and_never_follows_redirects() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        for redirect in [false, true] {
            let server = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}", server.local_addr().unwrap());
            let handle = std::thread::spawn(move || {
                let (mut stream, _) = server.accept().unwrap();
                let mut request = [0; 4096];
                let read = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                assert!(request.starts_with("GET /api/tags "));
                assert!(!request.to_lowercase().contains("authorization:"));
                let body = r#"{"models":[{"name":"fixture-vision:latest"}]}"#;
                let status = if redirect {
                    "302 Found\r\nLocation: http://127.0.0.1:1/"
                } else {
                    "200 OK"
                };
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            });
            let result = list("ollama", &endpoint, Some("must-not-send".into())).await;
            if redirect {
                assert!(result.unwrap_err().contains("302"));
            } else {
                assert_eq!(result.unwrap()[0].id, "fixture-vision:latest");
            }
            handle.join().unwrap();
        }
        assert!(list("ollama", "https://example.com", None).await.is_err());
        assert!(list("openai", "", None)
            .await
            .unwrap_err()
            .contains("API key"));
    }
    #[test]
    fn verifies_openai_ids_without_accepting_specialized_or_unknown_variants() {
        assert_eq!(openai_model("gpt-6.1-sol").vision, Some(true));
        assert!(openai_model("gpt-6.1-sol").rank < openai_model("gpt-6-astra").rank);
        assert_eq!(openai_model("gpt-4o-2024-08-06").completion, Some(true));
        for id in [
            "gpt-4o-audio-preview",
            "gpt-image-1",
            "text-embedding-3-small",
            "future-model",
            "gpt-6.1-sol-custom",
        ] {
            assert_eq!(openai_model(id).completion, None);
        }
        let mut model = openai_model("unknown");
        set_capabilities(&mut model, &json!({"capabilities":["completion"]}));
        assert_eq!(model.vision, Some(false));
        set_capabilities(&mut model, &json!({"capabilities":["vision","completion"]}));
        assert_eq!(model.vision, Some(true));
    }
}
