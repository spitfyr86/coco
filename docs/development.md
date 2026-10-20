# Development

```powershell
npm install
npm run check
cd src-tauri
cargo test --lib
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

UI checks:

```powershell
npx playwright install chromium
npm run test:ui
```

An already installed compatible Chromium can be selected without downloading another browser:

```powershell
$env:COCO_TEST_BROWSER = 'C:\path\to\chrome.exe'
npm run test:ui
```

For a headed run with installed Edge, use `COCO_TEST_BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` and `COCO_TEST_HEADED=1`. `tests/models.spec.ts` uses a browser-only IPC fixture for catalog/key interactions; it does not validate native credentials or live OpenAI access.

The browser tests verify both palettes, interaction, and axe accessibility. They do not prove native screenshot, microphone, credential, shortcut, or model compatibility. Screenshots are placed in the ignored `artifacts/` directory.

## Native checks

Run `npm run desktop` or `start.ps1` and verify:

1. Select a display and an ordinary visible application window. Fresh check should show an image of that source, with CoCo hidden during capture. Test scaling and multiple monitors on the intended device.
2. Select a disposable repository. Confirm initial source context, then modify/add/delete files between captures and inspect the changes. Confirm `.env`, ignored files, junctions, and generated files stay excluded.
3. Configure a local model or test server. Check initial guidance, clarification on the same checkpoint, another fresh check, provider errors, and cancellation. Use fixtures for provider testing.
4. Start voice input, wait for Listening, dictate, finish, and inspect/edit the transcript. Test output and interruption. A synthetic speech loopback is useful component evidence but does not prove real microphone accuracy.
5. Check both global shortcuts with the editor focused. Shortcut conflicts should be reported. Buttons remain available.
6. Exercise start/status/stop scripts and verify no unrelated development processes are terminated.
   Use `start.ps1 -Mode app` for the packaged build, or `start.ps1` for development. Check timestamped build/wait progress, readiness before success, duplicate start with a hidden window, and stop completion. A readiness timeout retains the tracked launch; `stop.ps1` can stop it afterward. All lifecycle notifications appear in the terminal.
7. Close with X and Alt+F4: the process and session must survive, with the window hidden. Restore by left-click and by tray Show CoCo; test restoring a minimized window. Tray Hide CoCo must preserve the session. Trigger a fresh check while hidden and confirm it stays hidden. Exit from the tray with voice active: CoCo and its voice workers must terminate.

For development-only native webview inspection, WebView2 supports the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable. Do not distribute a launcher that enables remote debugging. No debug port is enabled by CoCo normally.

`node scripts/native-smoke.mjs` attaches to an already running development CoCo webview at port 9237 (`COCO_CDP_URL` overrides this). It checks both themes with axe, native capture/preview, actual loopback HTTP provider requests, clarification reuse, microphone readiness, and cancellation. It temporarily saves fixture settings and restores the original settings in `finally`. It does not test a real model or human dictation. Use only a disposable session. The fixture stays on loopback and is shut down after the check.

`node scripts/native-models-smoke.mjs` uses the same attachment to verify a real loopback Ollama catalog, both Settings themes/axe, saved-model retention, empty/error catalogs, stale-response rejection, and saving a manual model. It restores settings in `finally`. It does not verify a live OpenAI account catalog. Rust tests additionally cover both provider response formats, loopback restriction, and redirect rejection. Catalog IDs alone do not establish model capabilities.

The model smoke also checks Screen-dependent filtering, Recommended resolution, and rejection of known incompatible manual choices. OpenAI capabilities and ranking use `src-tauri/model-policy.json`; update its source evidence and tests when changing the policy. Unknown IDs must not inherit guessed capabilities. `node scripts/native-key-loading-smoke.mjs` uses a CDP function-call breakpoint to observe actual UI discovery calls while rewriting discovery/save commands to an unregistered command before execution. It verifies the one-second debounce, cancellation across edits, and no save on key entry. It neither sends a test key to OpenAI nor validates live account access. This diagnostic is development-only; normal launches enable no debug port.

## Layout

- `src/`: UI, theme tokens, transcript rendering, native IPC bridge.
- `src-tauri/src/`: application/session commands, repository scan/diffs, captures, model providers, local voice.
- `src-tauri/native/voice.ps1`: embedded fixed System.Speech helper.
- `start.ps1` / `stop.ps1`: local lifecycle entry points.
- `scripts/`: process-scoped lifecycle tools.
- `tests/`: Playwright interaction/accessibility checks.
- `docs/`: product behavior, technical boundaries, verification.

Dependencies are locked in `package-lock.json` and `src-tauri/Cargo.lock`. Do not add a separate Python/Node runtime server or automatic background model calls without revisiting the size and privacy requirements.

## Saved-session checks

Use a disposable store and WebView2 profile, separate from your regular app. Stop the tracked development launch first, then run:

```powershell
$env:COCO_DATA_DIR = "$PWD\.local\saved-sessions-test\data"
$env:WEBVIEW2_USER_DATA_FOLDER = "$PWD\.local\saved-sessions-test\webview"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9237'
.\start.ps1
$env:COCO_ISOLATED_SESSION_TEST = '1'
node scripts/native-sessions-smoke.mjs
.\stop.ps1
.\start.ps1
$env:COCO_TEST_PHASE = 'resume'
node scripts/native-sessions-smoke.mjs
.\stop.ps1
Remove-Item Env:COCO_DATA_DIR, Env:WEBVIEW2_USER_DATA_FOLDER, Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:COCO_ISOLATED_SESSION_TEST, Env:COCO_TEST_PHASE
```

The seed phase uses a loopback provider fixture and changes only the isolated store. The resume phase checks disk recovery, separate conversations/drafts, stale context/reference bodies, and explicit deletion. Both palettes include axe checks. Start with a fresh disposable store when repeating the pair. `start.ps1 -Mode app` runs the same checks against the packaged build. The former destructive reset smoke was retired; New session now retains the previous session.

For Enter/Send and direct tab-rename regression checks, launch a disposable native instance with its own `COCO_DATA_DIR`, `WEBVIEW2_USER_DATA_FOLDER`, and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9240`. Then run `$env:COCO_ISOLATED_SEND_TEST='1'; node scripts/native-send-smoke.mjs`. This uses an owned loopback provider, an actual monitor screenshot held in memory, an invalid capture source, and both-theme axe checks. Never target the normal user store. `COCO_CDP_URL` can override the endpoint. The check creates retained fixture sessions; repeated runs need spare tab/history capacity.

Optional speech UI checks: launch an isolated native instance with its own `COCO_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER`, plus `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9241`. Run `$env:COCO_ISOLATED_SPEECH_TEST='1'; node scripts/native-speech-smoke.mjs`. Use a fresh disposable store. The script leaves fixture tabs/settings there, does not change credentials, and intercepts preview through CDP before native synthesis. Provider/audio contract tests use a loopback HTTP fixture in Rust. Never run the UI smoke against the normal user profile. See [speech behavior](speech.md).

Settings/scale checks: launch an isolated native instance with its own `COCO_DATA_DIR`, `WEBVIEW2_USER_DATA_FOLDER`, and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9244`. Run `$env:COCO_ISOLATED_SETTINGS_TEST='1'; node scripts/native-settings-smoke.mjs` against a fresh store. The test changes only isolated preferences, restores 100% at completion, and never changes credentials. It checks both themes at 150% and saves/reloads without requiring a coaching model.

Progress/layout checks: launch a fresh disposable native profile/store with `COCO_DATA_DIR`, `WEBVIEW2_USER_DATA_FOLDER`, and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9245`. Run `$env:COCO_ISOLATED_PROGRESS_TEST='1'; node scripts/native-progress-smoke.mjs`. The check owns a loopback provider and exercises plan delivery, progress, sizing, collapse, reload, session isolation, and both-theme accessibility. Never target the normal user store. The test retains fixture tabs/settings in its isolated store.

Automatic-progress checks: use a fresh disposable native store/profile and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9246`. Run `$env:COCO_ISOLATED_AUTO_PROGRESS_TEST='1'; node scripts/native-auto-progress-smoke.mjs`. The owned loopback fixture exercises opt-in, one-call assessments, manual locks, Undo, invalid output, stale forms, persistence/session isolation, and both-theme accessibility. No paid inference is used. `COCO_CDP_URL` overrides the endpoint. Never target the normal user profile.

Session transfer checks: launch a fresh disposable native store/profile with CDP port 9249, set `COCO_ISOLATED_TRANSFER_TEST=1` and `COCO_TEST_APP_PID` to that exact test executable PID, then run `node scripts/native-session-transfer-smoke.mjs`. The script drives actual native Save/Open dialogs through a PID/title-scoped Windows UI Automation/Win32 helper (`test-session-file-dialog.ps1`), writes owned fixtures under `.local/transfer-fixtures`, and checks one/all exports, copy import, cancel, invalid input, persistence, and both-theme accessibility. Never target the regular app/profile. No provider calls or clipboard manipulation are used.

## Windows icon assets

The Windows NSIS bundle and native window/tray use `src-tauri/icons/icon.ico`, as configured in `tauri.conf.json`. Only that icon is tracked. Unused platform/size variants generated by Tauri icon tooling remain ignored; they are not required for this Windows build. The web UI logo stays in `public/coco.svg`. If another platform is added, update the bundle configuration and icon ignore rules together.
