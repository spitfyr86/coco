# Changelog

## 0.1.0 — 2026-10-17

- Initial Tauri Code Coach MVP with manual screen/repository checkpoints and conversational guidance.
- Local Windows speech recognition/synthesis, Ollama and optional OpenAI providers, and secure key storage.
- VS Code light/dark appearance, context inspection, cancellation, and process-scoped start/stop tooling.
- Windows system tray with restore/hide actions, close-to-tray session preservation, and graceful Exit with voice/request cleanup.
- Renamed lifecycle entry points to `start.ps1` / `stop.ps1`; added live terminal progress, window-readiness checks, and verified shutdown.
- Discoverable model dropdown for installed Ollama models / OpenAI account models, refresh and error states, retained selections, and manual ID fallback.
- Capability filtering for enabled coaching inputs, an available-model Recommended choice with rationale, and automatic model loading after a one-second API-key debounce.
- Setup, architecture, privacy, version scope, and verification documentation.
- Native dropdown options and selected items follow the active light/dark theme, including screen-source and model menus.
- Saved reasoning-effort selector with Auto and verified model-specific OpenAI levels; native validation prevents unsupported effort requests.
- Session references for local files/folders, text PDFs, public HTTPS pages/documents, and pasted text; bounded redacted extraction, inspection, inclusion controls, refresh, and removal.
- New session asks before clearing any existing goal, draft, conversation, references, checkpoint, usage, or active voice input. Keep session is the default; Escape cancels.
- Saved sessions supersede the destructive New session action: independent tabs, automatic local saves, restart recovery, session history, rename/reopen, and separately confirmed deletion. Captured screen/repository/reference bodies remain temporary; delayed replies stay with their originating session.

- Restore CoCo immediately after screenshot capture, before repository scanning; restore on capture errors and bound screenshot waiting to ten seconds.
- Add direct tab renaming through a pencil, double-click, or F2, retaining the saved custom title.

- Add optional OpenAI natural speech with Windows default, voice/speed settings, explicit preview/stop, bounded in-memory WAV playback, and cancellation.
- Make active-session tabs distinct and display the selected session name in the conversation header.

- Connect the active session tab directly to its framed pane, with recessed inactive tabs, following the user's visual reference.

- Organize Settings into Appearance, AI model, Voice, and API key sections.
- Add app-wide text scaling from 85–150%, with live preview, saved persistence, Cancel rollback, and reset to 100%.

- Add per-session milestone plans, completion progress, and next-step display; include the user-maintained plan in requested coaching context.
- Add bounded context-sidebar resizing, keyboard controls, reset, and hamburger collapse/expand with saved per-session layout.

- Optional checkpoint-based AI milestone assessment, four visual status states, completion/history bars, protected manual corrections, Undo, validated provider output, and saved assessment history.

- Derive checkpoints and current status from the session goal, established plan, and saved conversation; load existing-session progress without freeform setup, keep an unassessed bar visible, and generate new-session plans with the first coaching reply.

- Add native JSON session export/import through History, individual/all-session exports, copy-only imports, disabled imported external inputs, bounded validation, and failed-import rollback.
