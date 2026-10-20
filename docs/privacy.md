# Privacy and context handling

- Capture is explicit. No screen recording or AI request runs on a timer.
- References are manually attached/refreshed snapshots. Local files/folders are read without modification; public HTTPS links contact the destination website without login cookies or browser credentials. Adding a reference does not call the AI. Checked extracted text and redacted source metadata are included when you next request coaching. See [supported formats, limits, and link handling](references.md).
- Goals, drafts, conversation text, reference locations, pasted text, and usage are saved locally with each session. Screenshots, repository snapshots, and extracted file/web reference bodies remain temporary. Inspect redacted reference text before sharing; previous conversation can still mention excluded material. See [saved-session storage and recovery](sessions.md). No PDF/image OCR is performed.
- Voice recognition starts explicitly and stops when requested, after 90 seconds, or on app exit. The helper uses installed Windows desktop speech services; there is no cloud transcription API in 0.1.
- Closing the window hides CoCo to the tray; it retains in-memory context and does not stop an active microphone session, speech output, or request. Use their Stop controls or tray **Exit** to end them. Hiding never starts new observation or provider calls.
- Repository access is read-only. CoCo never applies code, runs tests, installs dependencies in a selected repository, commits, or pushes.
- Source snippets, screenshots, and conversation are sent to the configured model when you request guidance. A local Ollama endpoint stays on loopback. Selecting OpenAI sends that context to OpenAI and incurs standard API usage. Provider retention policies remain the provider's responsibility; CoCo does not promise zero retention by external services.
- Images and repository snapshots are held in process memory and are not automatically written to disk. The OS can page process memory; memory-only is not a secure-erasure guarantee.
- No analytics, session recording, advertising, or telemetry SDK is included.
- Keys are stored in Windows Credential Manager, never in frontend storage or settings JSON. Removing a key is available in Settings.
- Opening Settings, changing provider/URL/key, or refreshing its model dropdown requests provider metadata. Key changes wait one second after typing stops. Ollama capability inspection reads local metadata without loading model weights. No screenshots, source code, or conversation are sent. A newly entered OpenAI key loads models before you save it; it is persisted only by Save settings.

## Exclusions

The scanner respects `.gitignore` and `.cocoignore`, skips symlinks/junctions and common build directories, and excludes common secret filenames such as `.env*`, credential/secret paths, private-key containers, and local/production appsettings files. Common inline credential assignments and recognizable key strings are redacted.

Filtering is best effort. It does not prove a repository or screenshot is safe to share. Screen pixels are **not** OCR-redacted. Close sensitive windows, choose a specific source, or switch Screen off. Do not select a sensitive repository for cloud coaching without reviewing its contents and exclusions. Add your own `.cocoignore` rules for private folders/files.

Example:

```gitignore
internal-customer-data/
private-config.json
**/fixtures/real-data/**
```

The checkpoint inspector shows the selected redacted files/diffs and screenshot. Fresh check both captures and sends; it is not a pre-send approval dialog. For sensitive work, configure local inference or turn off the relevant context input before requesting guidance.

## Instruction boundaries

Repository text and screenshots are treated as untrusted evidence. The coach is instructed to ignore embedded commands that conflict with its role. The model has no executable tools. This reduces the consequence of prompt injection; it does not guarantee perfect model behavior. Review guidance before acting.

Speech output can optionally send the spoken reply text to OpenAI using the existing stored API key. Voice selection alone does not send a synthesis request. Windows is the default. Audio stays in memory; previews and replays are explicit and may incur charges. See [speech details](speech.md).

Saved sessions also retain milestone titles/completion states and context-panel layout. The current milestone plan is included with explicitly requested coaching context, even when screen/repository capture is disabled. Titles can contain sensitive details; review what you retain and send. No background model call is triggered by progress or layout edits.

Optional automatic progress uses the same explicitly requested Fresh check call as coaching. The plan and prior assessment reasons/evidence can be included in provider context. Up to 30 assessment snapshots, manual protection flags, and Undo state are retained in the local session store; screen/source/reference bodies are still temporary. Enabling/disabling assessment alone makes no provider call.

When deriving an empty checkpoint plan, CoCo also sends bounded early/recent saved conversation (first/last 12 messages, 2,000 characters each) to recover the agreed plan and current progress. This happens only with an explicitly requested coaching reply or Load session progress, never on opening a tab. Derived checkpoints and evidence are saved locally with the session.

Session export creates an unencrypted JSON archive at your chosen local destination. It contains saved conversation, drafts, checkpoint evidence, pasted references, and local repository/reference paths; stored provider API keys/settings and temporary captures/extracted bodies are excluded. Common credential patterns are redacted, but arbitrary sensitive text can remain. Import validates the saved schema, creates copies, disables repository/reference inputs, and never reads linked contents or calls a model automatically.
