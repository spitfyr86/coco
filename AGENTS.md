# CoCo

- Keep the UI minimal: no eyebrow labels, duplicate copy, decorative badges, or unnecessary panels. Preserve actionable statuses and errors.
- Use VS Code Default Light Modern / Dark Modern semantic colors and support system preference.
- Screen/repository analysis and microphone input must remain explicitly user-triggered. No timer-based provider calls.
- Repository access is read-only. Never add model-executable tools or arbitrary command execution to the coaching flow.
- Keep source snippets/diffs bounded and redacted. Respect `.gitignore` / `.cocoignore` and skip symlinks/junctions.
- Keys belong in native credential storage. Do not log requests, repository bodies, screenshots, or API keys.
- Keep browser preview limitations explicit. Synthetic provider/speech tests do not prove live model/microphone behavior.
- Update docs when product behavior changes. Run frontend checks, relevant Rust tests/clippy, and both-theme UI checks.
- No automatic commits, pushes, publishing, or unrelated cleanup.
