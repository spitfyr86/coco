use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path},
    process::Command,
    sync::OnceLock,
};

const MAX_FILES: usize = 2500;
const MAX_BYTES: u64 = 192 * 1024;
const MAX_TOTAL_BYTES: usize = 24 * 1024 * 1024;
const CONTEXT_BUDGET: usize = 42_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub kind: String,
    pub patch: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    pub path: String,
    pub text: String,
    pub truncated: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoReport {
    pub root: String,
    pub branch: Option<String>,
    pub revision: Option<String>,
    pub file_count: usize,
    pub skipped: usize,
    pub limited: bool,
    pub tree: Vec<String>,
    pub changes: Vec<Change>,
    pub files: Vec<ContextFile>,
    pub baseline: bool,
}
#[derive(Clone, Default)]
pub struct Checkpoint {
    pub report: RepoReport,
    pub contents: BTreeMap<String, String>,
    pub hashes: BTreeMap<String, String>,
}

pub fn allowed_path(path: &Path) -> bool {
    for component in path.components() {
        if let Component::Normal(part) = component {
            let name = part.to_string_lossy().to_lowercase();
            if matches!(
                name.as_str(),
                ".git"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | "bin"
                    | "obj"
                    | "vendor"
                    | ".next"
                    | ".nuxt"
                    | ".venv"
                    | "venv"
                    | "__pycache__"
                    | "coverage"
                    | ".idea"
                    | ".vs"
                    | ".ssh"
                    | ".aws"
                    | ".azure"
                    | ".terraform"
                    | "artifacts"
                    | "test-results"
                    | "playwright-report"
                    | "secrets"
                    | "credentials"
            ) || name.starts_with(".env")
                || name.contains("credential")
                || name.contains("secret")
                || name.ends_with(".pem")
                || name.ends_with(".pfx")
                || name.ends_with(".key")
                || name.ends_with(".p12")
                || name.ends_with(".keystore")
                || name == "id_rsa"
                || name.starts_with("appsettings.production")
                || name.starts_with("appsettings.development")
            {
                return false;
            }
        }
    }
    true
}

fn text_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if matches!(
        name.as_str(),
        "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "cargo.lock" | "composer.lock"
    ) {
        return false;
    }
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    matches!(
        ext.as_str(),
        "rs" | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "cs"
            | "csproj"
            | "sln"
            | "slnx"
            | "props"
            | "targets"
            | "fs"
            | "vb"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "swift"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "html"
            | "css"
            | "scss"
            | "less"
            | "vue"
            | "svelte"
            | "json"
            | "jsonc"
            | "toml"
            | "yaml"
            | "yml"
            | "xml"
            | "md"
            | "txt"
            | "sql"
            | "graphql"
            | "prisma"
            | "sh"
            | "ps1"
            | "bat"
            | "cmd"
            | "razor"
            | "xaml"
            | "gitignore"
            | "cocoignore"
    ) || matches!(
        name.as_str(),
        "dockerfile"
            | "makefile"
            | "justfile"
            | "readme"
            | "license"
            | ".gitignore"
            | ".cocoignore"
            | ".editorconfig"
    )
}

pub fn redact(text: &str) -> String {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| vec![
        Regex::new(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----").unwrap(),
        Regex::new(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b").unwrap(),
        Regex::new(r#"(?im)(?:api[_-]?key|password|client[_-]?secret|access[_-]?token|connectionstring)\s*["']?\s*[:=]\s*["'][^"'\r\n]+["']"#).unwrap(),
    ]);
    patterns.iter().fold(text.to_owned(), |value, re| {
        re.replace_all(&value, "[REDACTED]").into_owned()
    })
}

pub fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn git_info(root: &Path, arg: &str) -> Option<String> {
    let mut command = Command::new("git");
    command
        .args(["--no-optional-locks", "rev-parse", arg])
        .current_dir(root);
    super::hide_console(&mut command);
    let result = command.output().ok()?;
    result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
}

pub fn scan(root: &str, previous: Option<&Checkpoint>, query: &str) -> Result<Checkpoint, String> {
    let canonical = fs::canonicalize(root)
        .map_err(|_| "That repository directory is unavailable.".to_string())?;
    if !canonical.is_dir() {
        return Err("Select a directory, rather than a file.".into());
    }
    let root_string = canonical.to_string_lossy().to_string();
    let branch = git_info(&canonical, "--abbrev-ref=HEAD");
    let revision = git_info(&canonical, "HEAD");
    let same_root = previous.filter(|p| p.report.root == root_string);
    let baseline =
        same_root.is_none_or(|p| p.report.branch != branch || p.report.revision != revision);
    let mut checkpoint = Checkpoint {
        report: RepoReport {
            root: root_string,
            branch,
            revision,
            baseline,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut walker = WalkBuilder::new(&canonical);
    walker
        .hidden(false)
        .require_git(false)
        .follow_links(false)
        .add_custom_ignore_filename(".cocoignore");
    let root_for_filter = canonical.clone();
    walker.filter_entry(move |entry| {
        let relative = entry
            .path()
            .strip_prefix(&root_for_filter)
            .unwrap_or(entry.path());
        allowed_path(relative)
            && entry
                .path()
                .symlink_metadata()
                .is_ok_and(|m| !is_reparse(&m))
    });
    let mut total = 0;
    for entry in walker.build() {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                checkpoint.report.skipped += 1;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|f| f.is_file()) {
            continue;
        }
        if !text_file(entry.path()) {
            continue;
        }
        if checkpoint.hashes.len() >= MAX_FILES || total >= MAX_TOTAL_BYTES {
            checkpoint.report.limited = true;
            break;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                checkpoint.report.skipped += 1;
                continue;
            }
        };
        if metadata.len() > MAX_BYTES {
            checkpoint.report.skipped += 1;
            continue;
        }
        let bytes = match fs::read(entry.path()) {
            Ok(b) if b.len() as u64 <= MAX_BYTES => b,
            _ => {
                checkpoint.report.skipped += 1;
                continue;
            }
        };
        let text = match String::from_utf8(bytes.clone()) {
            Ok(t) if !t.contains('\0') => t,
            _ => {
                checkpoint.report.skipped += 1;
                continue;
            }
        };
        total += bytes.len();
        let path = entry
            .path()
            .strip_prefix(&canonical)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        checkpoint
            .hashes
            .insert(path.clone(), format!("{:x}", Sha256::digest(&bytes)));
        checkpoint.contents.insert(path, redact(&text));
    }
    checkpoint.report.file_count = checkpoint.hashes.len();
    checkpoint.report.tree = checkpoint.hashes.keys().take(350).cloned().collect();
    if let Some(old) = same_root.filter(|_| !baseline) {
        for (path, hash) in &checkpoint.hashes {
            if old.hashes.get(path) != Some(hash) {
                let kind = if old.hashes.contains_key(path) {
                    "modified"
                } else {
                    "added"
                };
                let before = old.contents.get(path).map(String::as_str).unwrap_or("");
                let after = &checkpoint.contents[path];
                let diff = similar::TextDiff::from_lines(before, after)
                    .unified_diff()
                    .context_radius(3)
                    .header(path, path)
                    .to_string();
                checkpoint.report.changes.push(Change {
                    path: path.clone(),
                    kind: kind.into(),
                    patch: clip(&diff, 6000),
                });
            }
        }
        // An incomplete scan cannot establish deletion.
        if !checkpoint.report.limited && checkpoint.report.skipped == 0 {
            for path in old
                .hashes
                .keys()
                .filter(|p| !checkpoint.hashes.contains_key(*p) && !canonical.join(p).exists())
            {
                checkpoint.report.changes.push(Change {
                    path: path.clone(),
                    kind: "deleted".into(),
                    patch: String::new(),
                });
            }
        }
    }
    let words: Vec<_> = query
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '.')
        .filter(|w| w.len() >= 3)
        .map(str::to_lowercase)
        .take(60)
        .collect();
    let mut ranked: Vec<_> = checkpoint
        .contents
        .iter()
        .map(|(path, text)| {
            let lower = path.to_lowercase();
            let name = lower.rsplit('/').next().unwrap_or(&lower);
            let mut score = if matches!(
                name,
                "readme.md"
                    | "agents.md"
                    | "package.json"
                    | "cargo.toml"
                    | "pyproject.toml"
                    | "go.mod"
            ) {
                30
            } else {
                0
            };
            if lower.matches('/').count() < 2 {
                score += 3;
            }
            if checkpoint.report.changes.iter().any(|c| c.path == *path) {
                score += 70;
            }
            let excerpt = clip(text, 10_000).to_lowercase();
            for word in &words {
                if lower.contains(word) {
                    score += 20;
                } else if excerpt.contains(word) {
                    score += 2;
                }
            }
            (score, path, text)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    let mut budget = CONTEXT_BUDGET;
    for (_, path, text) in ranked.into_iter().take(14) {
        if budget < 500 {
            break;
        }
        let limit = budget.min(6500);
        let excerpt = clip(text, limit);
        budget -= excerpt.chars().count();
        checkpoint.report.files.push(ContextFile {
            path: path.clone(),
            truncated: text.chars().count() > limit,
            text: excerpt,
        });
    }
    // Bound change material independently from the UI's full changed-path list.
    let mut patch_budget: usize = 24_000;
    for change in &mut checkpoint.report.changes {
        change.patch = clip(&change.patch, patch_budget.min(6000));
        patch_budget = patch_budget.saturating_sub(change.patch.chars().count());
    }
    Ok(checkpoint)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_omits_secrets_and_generated_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".env"), "API_KEY=never-send").unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules/leak.ts"), "private").unwrap();
        fs::write(dir.path().join("main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join(".cocoignore"), "private.rs\n").unwrap();
        fs::write(dir.path().join("private.rs"), "private").unwrap();
        let checkpoint = scan(dir.path().to_str().unwrap(), None, "").unwrap();
        assert!(checkpoint.hashes.contains_key("main.rs"));
        assert!(!checkpoint.hashes.contains_key("private.rs"));
        assert!(!serde_json::to_string(&checkpoint.report)
            .unwrap()
            .contains("never-send"));
        assert!(!checkpoint.hashes.keys().any(|p| p.contains("node_modules")));
    }
    #[test]
    fn diffs_are_between_requests_even_without_git() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        fs::write(dir.path().join("a.rs"), "before\n").unwrap();
        let first = scan(path, None, "").unwrap();
        fs::write(dir.path().join("a.rs"), "after\n").unwrap();
        fs::write(dir.path().join("b.ts"), "new\n").unwrap();
        let second = scan(path, Some(&first), "").unwrap();
        assert!(!second.report.baseline);
        assert_eq!(second.report.changes.len(), 2);
        assert!(second.report.changes[0].patch.contains("+after"));
        fs::remove_file(dir.path().join("b.ts")).unwrap();
        let third = scan(path, Some(&second), "").unwrap();
        assert_eq!(third.report.changes[0].kind, "deleted");
    }
    #[test]
    fn sanitizes_common_inline_keys_and_unicode_clipping() {
        assert!(!redact("api_key = \"sensitive-value\"").contains("sensitive-value"));
        assert_eq!(clip("ab🦀cd", 3), "ab🦀");
        assert!(!allowed_path(Path::new("sub/.env.local")));
    }
}
