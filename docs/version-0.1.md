# Version 0.1

## Included

- Windows Tauri desktop app with a minimal React UI and VS Code Light Modern/Dark Modern palettes.
- Explicit goal, optional repository, selectable screen/window, fresh-check shortcut, and clarification using the last checkpoint.
- Bounded repository context, common secret exclusions, local content fingerprints, saved-file diffs, and branch/revision baseline resets.
- Optional session references: local files/folders, text PDFs, public HTTPS pages/documents, and pasted text, with bounded extraction, previews, inclusion toggles, refresh, and removal. See [format support and limits](references.md).
- Ollama and OpenAI Responses provider integration; secure API-key storage and completed-request token counters.
- Provider-backed model dropdown with compatible-input filtering, Recommended selection and rationale, automatic key-entry loading, refresh/error states, and an explicit unverified manual-ID fallback. OpenAI uses a checked capability policy; Ollama reports its own capabilities.
- Two-way local Windows speech: toggle-to-talk, editable transcript, spoken guidance, repeat, and stop.
- Markdown/code display, copy response, always-on-top control, cancellable requests, and new sessions.
- Independent saved session tabs, local autosave, restart recovery, history with rename/reopen, and separately confirmed deletion. New session retains the previous session; closing a tab keeps it in history.
- System tray Show/Hide/Exit; closing the window preserves the session in the tray.
- Start/stop/status/restart scripts, development setup, packaging, architecture, privacy, and verification docs.

## Deliberate limits

- Windows-only capture/voice qualification for this release. The architecture does not establish support on other operating systems.
- Toggle-to-talk instead of hold-to-talk. Voice transcripts require Send; they are not silently submitted.
- No continuous screen analysis, code edits, terminal execution, or test runner.
- Only saved code is available. Unsaved editor buffers require a future editor extension.
- Lexical context selection can omit important related files. Large repositories are bounded, and truncation is visible.
- Conversations/drafts and reference locations are saved locally; captured screen/repository/file/web bodies are temporary. Export, search, cloud sync, and semantic session compaction are future work. Initial bounds: eight open tabs, 100 saved sessions, 2,000 messages / 8 MiB per session.
- Reference extraction supports text PDFs, UTF-8 text/code, and HTML. Scanned PDFs, images, Office/binary formats, and login/JavaScript-dependent web content require text/PDF export or pasted content; no OCR or browser-login integration is included.
- Provider replies are returned when complete, not token-streamed. Local models can be slow; the request timeout is 120 seconds.
- Token counters cover successful responses and are not a billing ledger. Failed/cancelled requests may still cost money. There is no built-in spend cap.
- No ChatGPT subscription sign-in, automatic model installation, cloud speech, custom voice selection, or automatic screen secret redaction.
- The initial app uses a resizable desktop window with an always-on-top toggle and a system tray icon. Closing the window hides it; the tray restores it and provides the app's only normal Exit action. A separate compact overlay is future work.

## Acceptance scenario

Use a disposable code repository with a reproducible failing test. Ask CoCo for the first investigation step. Request a spoken clarification, save an edit, rerun the test yourself, then take a fresh checkpoint. CoCo should use actual changed code and visible output, acknowledge missing evidence, and avoid claiming it ran anything. Qualification requires a configured real model and human microphone feedback in addition to automated component tests.

## Optional natural speech and active-session ownership

Added Settings speech-provider selection with Windows as the default, optional OpenAI natural speech using the existing secure key, voice/speed selection, explicit preview/stop, and an additional-cost/data notice. Automatic read-aloud remains independently optional. Audio is bounded and memory-only; cancellation prevents late playback. See [speech behavior](speech.md).

Active tabs now use an accent fill, stronger border, marker, and weight, and the conversation header displays the selected session title.
