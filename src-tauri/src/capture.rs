use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub label: String,
    pub kind: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub data_url: String,
    pub source: String,
    pub width: u32,
    pub height: u32,
}

pub fn sources() -> Result<Vec<Source>, String> {
    let mut result = Vec::new();
    for (i, monitor) in xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
    {
        result.push(Source {
            id: format!("monitor:{}", monitor.id().map_err(|e| e.to_string())?),
            label: format!(
                "Display {} · {} × {}",
                i + 1,
                monitor.width().unwrap_or(0),
                monitor.height().unwrap_or(0)
            ),
            kind: "monitor".into(),
        });
    }
    if let Ok(windows) = xcap::Window::all() {
        for window in windows {
            let title = window.title().unwrap_or_default();
            if title.is_empty() || title == "CoCo" || window.is_minimized().unwrap_or(true) {
                continue;
            }
            if let Ok(id) = window.id() {
                result.push(Source {
                    id: format!("window:{id}"),
                    label: title,
                    kind: "window".into(),
                });
            }
        }
    }
    Ok(result)
}

pub fn capture(id: &str) -> Result<Screen, String> {
    let (kind, id_value) = id.split_once(':').ok_or("Select a capture source first.")?;
    let numeric = id_value
        .parse::<u32>()
        .map_err(|_| "Invalid capture source.")?;
    let image = match kind {
        "monitor" => xcap::Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| m.id().ok() == Some(numeric))
            .ok_or("That display is no longer available.")?
            .capture_image(),
        "window" => xcap::Window::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|w| w.id().ok() == Some(numeric))
            .ok_or("That window is no longer available.")?
            .capture_image(),
        _ => return Err("Invalid capture source.".into()),
    }
    .map_err(|e| format!("Screen capture failed: {e}"))?;
    let image = DynamicImage::ImageRgba8(image)
        .resize(1920, 1200, FilterType::Triangle)
        .to_rgb8();
    let (width, height) = image.dimensions();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 84)
        .encode_image(&image)
        .map_err(|e| e.to_string())?;
    Ok(Screen {
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)),
        source: id.into(),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires an interactive Windows desktop; image remains in memory"]
    fn native_monitor_capture() {
        let source = sources()
            .unwrap()
            .into_iter()
            .find(|s| s.kind == "monitor")
            .unwrap();
        let screen = capture(&source.id).unwrap();
        assert!(screen.width > 0 && screen.width <= 1920);
        assert!(screen.height > 0 && screen.height <= 1200);
        assert!(screen.data_url.starts_with("data:image/jpeg;base64,"));
        let bytes = STANDARD
            .decode(screen.data_url.split_once(',').unwrap().1)
            .unwrap();
        assert!(image::load_from_memory(&bytes).is_ok());
    }
}
