# Verification · 0.1.0

## Saved sessions (2026-10-18)

Supersedes the earlier confirmation-only New session behavior and its reset smoke. Frontend lint, five unit tests, TypeScript/Vite build, 19 Rust tests, and clippy with warnings denied passed; two interactive capture/speech tests remain skipped. The isolated native WebView2 saved-session smoke passed seed and restart/resume phases: delayed replies stay in their originating tab, drafts/conversations persist separately, rename/close/reopen works, both themes pass axe, file extraction bodies stay out of saved JSON, resumed context requires refresh, and deletion requires explicit confirmation with Keep focused. No paid inference was used. Screenshots: `artifacts/native-sessions-dark.png` and `native-sessions-light.png`. Human dictation and hardware power-loss recovery were not established by these checks.

Verified on this Windows workstation on 2026-10-17. These checks distinguish implemented behavior from external compatibility that has not been established.

| Check | Result |
| --- | --- |
| TypeScript production build | Passed |
| ESLint | Passed |
| Frontend unit tests | 4 passed (rechecked 2026-10-18) |
| Rust tests including native checks | 11 passed (rechecked 2026-10-18) |
| Rust clippy with warnings denied | Passed |
| Rust formatting | Passed |
| npm dependency audit | 0 reported vulnerabilities at verification time |
| Native WebView2, both themes | Rendered and visually inspected |
| Native WebView2 accessibility | No axe violations in both themes and Settings |
| Compact 760 × 600 layout | Visually inspected; no document overflow |
| Native display capture | JPEG produced, decoded, and previewed |
| Real local HTTP provider fixture | Request schema, screenshot input, guidance, history, and token usage passed |
| Clarification | Reused checkpoint 1, with conversation history |
| Cancellation | Returned to idle with an explicit cancelled status |
| Windows speech loopback | Synthesized “check the code” and recognized it from an in-memory audio stream |
| Default microphone | Recognizer reached ready and stopped successfully |
| Global shortcuts | Registered without conflicts; foreground-editor keyboard behavior still needs human verification |
| Lifecycle scripts | Start, status, duplicate-start protection, and stop passed; the updated force-stop removed an active voice worker and preserved an unrelated sibling process |
| Tray lifecycle | Packaged app: X and Alt+F4 hid the window; tray left-click restored the same webview and goal; native capture while hidden stayed hidden |
| Tray menu | Show CoCo / Hide CoCo / Exit visually inspected. Menu selection and active-voice Exit cleanup still need a manual UI check; automation could not reliably target the auto-hidden Windows taskbar/menu |
| Packaged executable | The native integration flow also passed against the final release executable, without a development server |
| NSIS packaging | Built `CoCo_0.1.0_x64-setup.exe` (2.69 MiB); unsigned, not installed during verification |

The standalone Chromium Playwright runner encountered a workstation policy restriction (`exitCode=1260`). It is not reported as passing. Equivalent interaction/accessibility checks were performed successfully against CoCo's actual WebView2 runtime using `scripts/native-smoke.mjs`.

The provider integration checks use an owned loopback fixture, not a real AI model. They prove plumbing, context assembly, and error/cancellation behavior, not coding-advice quality or external model availability. No paid inference was required. Human dictation accuracy, audible output quality, protected/window-specific capture scenarios, mixed DPI/HDR, and other machines remain qualification work.

Developer screenshots and machine-readable native results are in ignored `artifacts/`. Clean theme screenshots are included under `docs/images/` for review.

Lifecycle scripts rechecked on 2026-10-18 after renaming the entry points to `start.ps1` and `stop.ps1`. An isolated copy of the packaged app passed real startup/window readiness, hidden duplicate-start protection, verified shutdown, repeated stop, and busy-port failure. Controlled launcher processes confirmed early-exit errors and readiness timeout with retained state followed by successful stop. The running development instance was preserved. Lifecycle feedback is terminal-only: timestamped phases, build/wait status, progress indicators, completion, and errors.

Model dropdown rechecked on 2026-10-18: frontend lint/build and two unit tests passed; ten Rust tests (including capture/speech) and clippy passed. `scripts/native-models-smoke.mjs` passed in actual WebView2: both themes/axe, local HTTP catalog, retained selection, errors/empty lists, ignored stale results, and manual save. The existing native coaching smoke also passed with dropdown selection. Both native scripts passed against the rebuilt release executable as well as the development app. Screenshots are `artifacts/native-models-dark.png` and `native-models-light.png`. The separate headed Edge Playwright run closed unexpectedly and is not reported as passing. OpenAI catalog parsing is covered by Rust tests; live account discovery remains unverified.

Recommendation/filtering update on 2026-10-18: four frontend tests and eleven Rust tests (including native capture/speech), lint/build, formatting, and clippy passed. The native model smoke now additionally verifies Screen-dependent filtering, Recommended selection, replacement of an unverified saved choice in the dialog, known-incompatible manual rejection, and saving an unknown manual override. Native coaching sends the resolved model ID. `native-key-loading-smoke.mjs` confirmed one discovery call after rapid key edits and no save attempt; its CDP diagnostic intercepted discovery/save commands before execution, so this is UI wiring/timing evidence rather than live OpenAI authentication. Official documentation for all seven policy families confirmed text/image input, text output, and Responses API support. Recommendation quality is a documented heuristic, not a measured coding benchmark.

The rebuilt release executable passed all three native smoke scripts for this update. The development launch was restored afterward with no remote-debugging listener. Account-specific OpenAI catalog/inference access is still not established by these fixture-based checks.

The earlier standalone executable with tray, compatible-model recommendations, and automatic discovery was 8,336,384 bytes. Installer/executable size does not include the shared WebView2 runtime, user-installed model weights, or Rust build outputs. A separately launched sibling process survived the packaged-app stop test. Normal launch scripts do not enable remote debugging.

Reasoning effort rechecked on 2026-10-18: frontend lint, five unit tests, and build passed; ten Rust tests passed (two unrelated interactive capture/speech tests skipped), and clippy passed with warnings denied. Coverage includes old settings defaulting to Auto, explicit Responses payload mapping, Auto omission, strict model/snapshot matching, and invalid provider/model/effort rejection. `scripts/native-effort-smoke.mjs` passed in development WebView2 for both themes: allowed choices, fallback to Auto, persisted selection, native rejection, and axe accessibility. Screenshots are `artifacts/native-effort-dark.png` and `native-effort-light.png`. Discovery was intercepted before execution; no external catalog requests or paid inference were used. These checks establish UI and request plumbing, not live model quality or latency.

The native model-picker regression script also passed after adding effort control. The Windows release executable and NSIS installer rebuilt successfully (installer 2.70 MiB); effort UI checks were performed against the development runtime. The normal development launch was restored with remote debugging disabled.

References rechecked on 2026-10-18: frontend lint/build and five frontend tests passed; fifteen Rust tests passed (two unrelated interactive capture/speech tests skipped), with clippy warnings denied. New Rust coverage includes a generated real PDF, HTML extraction/hidden-script removal, binary/empty errors, folder ignores and exclusions, clipping/redaction, strict HTTPS/public-IP checks, query stripping, and excluded references. `scripts/native-references-smoke.mjs` passed in actual development WebView2 for both themes and axe accessibility. It verifies typed file/folder attachment, PDF extraction, pasted text, visible failed link status, reference delivery in a loopback coaching payload, exclusion, refresh failure replacing stale text, removal, eight-attachment limit, and New session reset. An opt-in public HTTPS fetch of example.com also passed. No paid inference was used. File-picker dialogs, real LinkedIn access, scanned-PDF OCR, and unsupported Office formats were not established by these tests. Screenshots: `artifacts/native-references-dark.png` and `native-references-light.png`.

The reference smoke script also passed against the rebuilt release executable, including both themes and accessibility. The Windows NSIS installer rebuilt successfully at approximately 3.23 MiB. After the final public-address hardening, the five reference unit tests and warnings-denied clippy check passed again. Normal development launch was restored with debugging disabled after qualification.

New-session protection checked on 2026-10-18: `scripts/native-session-reset-smoke.mjs` passed in an isolated native development instance, in both themes with axe accessibility. It verifies focus on Keep session, Enter activating Keep rather than discard, Escape preserving the goal/draft/references, explicit discard clearing them, draft-only/reference-only protection, and direct reset of an empty session. No model calls or settings changes were used. The test instance uses its own WebView2 profile and CDP port; the user's running instance is not reset or restarted. The UI change keeps the existing App hook order so development hot reload can preserve the live session. This is a confirmation guard, not persistent history or recovery after an explicitly confirmed reset.

Frontend lint, five existing unit tests, and production build passed. The rebuilt Windows executable also passed the same isolated native session-reset checks in both themes. The NSIS installer rebuilt successfully (approximately 3.23 MiB); the isolated test process was stopped afterward while the original development launch remained running.

A separate headed Edge browser-suite attempt completed one preview test, but four checks were interrupted by browser/page closure. The cause was not established; this run is not counted as passing. Native WebView2 both-theme/accessibility checks above passed independently.

The release executable and NSIS installer rebuilt successfully (installer approximately 3.29 MiB). Both seed and restart/resume phases also passed against the packaged executable in a fresh isolated store. The original profile was kept separate from these destructive test fixtures.

## Send visibility and tab renaming (2026-10-19)

The first message can capture context. Previously the window stayed hidden during both screenshot capture and repository scanning; it could look closed while a scan ran. It now restores immediately after screenshot capture, before repository scanning/inference. Capture failures restore it too, and screenshot waiting times out after ten seconds. A timed-out blocking capture worker cannot be forcibly cancelled and may finish in the background; its result is discarded. Intentional tray hiding remains respected. No crash was established from the user's running process/logs.

`COCO_ISOLATED_SEND_TEST=1 node scripts/native-send-smoke.mjs` passed against an isolated development WebView2 instance: Enter and Send deliver loopback replies, the native window is visible during pending inference and after a bad capture-source error, F2/pencil renaming persists through reload, and both themes pass axe. Frontend lint/build/five unit tests, 19 Rust tests (two interactive tests ignored), and clippy with warnings denied passed. No external inference or original-profile changes were used by the test.

The rebuilt release executable/NSIS installer also passed the isolated send/rename checks, including a first message sent by Enter, a clarification sent by button, and a separate first message sent by button. Native visibility was checked while fixture inference remained pending. Double-click, F2, and pencil renaming passed; custom names survived reload. The isolated test executable was stopped afterward; the normal development instance remains running.

## Optional natural speech and tab ownership (2026-10-19)

Frontend lint, five unit tests, TypeScript/Vite build, 23 Rust tests, and clippy with warnings denied passed. Two existing interactive capture/speech tests remain ignored. New tests cover backwards-compatible Windows speech defaults, option validation, request model/voice/WAV format, WAV validation, HTTP errors/redirect rejection, and Stop cancelling pending speech generation. A generated silent PCM WAV passed through the real Windows SoundPlayer helper without a provider call; this verifies the playback path, not voice quality.

`scripts/native-speech-smoke.mjs` passed against a disposable native WebView2 profile. It verifies Windows default, no synthesis on selection, explicit preview voice/speed payload, Cancel retaining Windows, selected tab/background distinction, conversation-heading ownership, and axe accessibility in both palettes. The successful UI run intercepts the speech command through a CDP function-call breakpoint and rewrites it before native execution. No valid-key synthesis was performed; live account access and natural voice quality remain unverified. An earlier unsuccessful fixture attempt reached the endpoint with an invalid test key; it generated no speech. Screenshots: `artifacts/speech-dark.png`, `speech-light.png`, `tabs-dark.png`, and `tabs-light.png`. Shortcut-conflict notices in the test app are expected because the normal app retains the shortcuts.

The release executable and NSIS installer rebuilt (approximately 3.31 MiB). The isolated native speech/tab smoke also passed against the packaged executable, including persistence of provider/voice/speed through native settings reload and restoration to Windows afterward. No valid-key OpenAI synthesis was performed. The isolated executable was stopped; the normal development app remains running. The final cancellation registration is atomic so overlapping replay/Stop calls cannot register stale playback after replacement.

## Connected session tabs (2026-10-19)

Adjusted CSS to follow the user's tab/pane reference: shared active-tab/pane background, an open lower tab edge, recessed inactive tabs, and one frame around the sidebar plus conversation. Removed the separate accent rule across the conversation header. Frontend lint, five unit tests, and production build passed. Isolated native WebView2 checks passed in both palettes with axe, zero tab/pane vertical gap, matching backgrounds, and correct session heading after switching. Both screenshots were visually inspected: `artifacts/connected-tabs-dark.png` and `connected-tabs-light.png`. No Rust behavior changed.

The executable and NSIS installer rebuilt successfully with the connected-tab styling. The normal development app remains running with the CSS update; the isolated test app was stopped.

## Settings sections and text size (2026-10-19)

Frontend lint/build and five unit tests passed. All 23 Rust tests passed (two existing interactive tests ignored), and clippy passed with warnings denied. `scripts/native-settings-smoke.mjs` passed in isolated development WebView2: four section panels and axe in both themes at 150%, no horizontal modal overflow, app-wide font scaling, save/reload persistence without a configured model, Cancel restoring the saved scale, reset to 100%, and native rejection of an out-of-range size. Screenshots `artifacts/settings-size-dark.png` and `settings-size-light.png` were visually inspected. No paid model or speech requests were made.

The existing isolated native speech UI smoke also passed through the new section navigation, confirming that voice preview/settings behavior remains available. No paid synthesis was performed.

The rebuilt Windows executable and NSIS installer also passed the isolated native settings/text-size checks, including 150% sizing/accessibility in both themes, save/reload, Cancel rollback, reset, and bounds. The isolated executable was stopped. The normal development app remains running; its saved size was not changed by these tests.

## Goal milestones and resizable context (2026-10-20)

Frontend lint, five unit tests, and production build passed. All 24 Rust tests passed (two existing interactive tests ignored), and clippy passed with warnings denied. New coverage checks legacy session defaults, milestone/layout persistence, duplicate milestone IDs, width bounds, and coaching context. `scripts/native-progress-smoke.mjs` passed in isolated development WebView2: editable/completed milestones, saved progress, per-session isolation, an owned loopback coaching request containing the completion states, drag/keyboard resizing, collapse and reload restoration, Settings access while collapsed, and both-theme axe. The screenshots `artifacts/progress-collapsed-dark.png`, `progress-collapsed-light.png`, and `progress-expanded.png` were visually inspected. No paid inference was used. Progress is user-maintained, not an independently verified estimate of goal completion.

The Windows executable and NSIS installer rebuilt (approximately 3.32 MiB). The same isolated milestone/layout smoke passed against the packaged executable in both palettes. The isolated executable was stopped afterward; the normal development app remains running with the updated feature.

## Automatic checkpoint progress (2026-10-20)

Frontend lint, five unit tests, and production build passed. Rust: 29 tests passed, two existing interactive tests ignored; clippy passed with warnings denied. New tests cover invalid assessment envelopes/statuses/IDs, duplicate IDs, missing completion evidence, legacy manual completion, concurrent title edits, protected manual corrections, Undo, stale checkpoint gating, and assessment serialization.

`scripts/native-auto-progress-smoke.mjs` passed in an isolated native WebView2 store/profile with an owned loopback provider: default off, explicit opt-in, assessment in the same Fresh check call, four status states, visual bars/markers/history, follow-ups without reassessment, manual locks, Undo, malformed output leaving progress unchanged, save/reload, stale form epoch rejection, and session isolation. The updated suite checks both the scrolled-to-top history/editor and main view with axe in both themes. A contrast failure in dimmed undone history text was fixed before the final passing run. Screenshots `artifacts/auto-progress-dark.png`, `auto-progress-light.png`, `auto-progress-main-dark.png`, and `auto-progress-main-light.png` were visually inspected. Existing `native-progress-smoke.mjs` also passed for milestone edits, saved state, sidebar resizing/collapse, and Settings access.

A full isolated native process restart restored automatic opt-in, two assessment snapshots, Undo state, manual protection, and completed counts. One immediate UI action after restoring a tab timed out during mounting; retry after mounting succeeded and screenshots were captured. No paid inference or live assessment-quality validation was performed. Model output remains an assessment of supplied evidence, not independent verification of the goal.

The final Windows executable and NSIS installer rebuilt (approximately 3.34 MiB installer). The complete isolated automatic-progress smoke also passed against the packaged executable, including both-theme accessibility of the main tracker and editor/history. The isolated executable was stopped afterward; the normal development instance remains running. No paid model calls or credential changes were made.

## Plans derived from the session (2026-10-20)

Replaced freeform milestone setup as the primary flow. Empty sessions show an unassessed progress bar; a normal first coaching reply derives a goal-specific plan. Load session progress reconstructs an existing saved session's plan/current status from bounded early/recent conversation without a new screen capture. Existing saved trackers restore without model calls. Derived plans enable subsequent Fresh check assessment, preserving manual locks and Undo.

Frontend lint, five tests, and production build passed; 31 Rust tests passed (two existing interactive tests ignored), and clippy passed with warnings denied. New native tests confirm recovery of the original plan from saved conversation, first-reply generation, visible unassessed progress, same-request assessment, status/history persistence, invalid-output fallback, protected corrections, Undo, and both-theme axe in the main view/editor. The legacy saved-plan/sidebar regression also passed. Native tab selectors now explicitly target the non-hidden panel to avoid selecting a panel while tab activation is still in progress. Screenshots remain in `artifacts/auto-progress-*.png`. Owned loopback fixtures were used; no paid calls or live model-quality claim.

The rebuilt Windows executable and NSIS installer passed the complete derived-plan native smoke in both themes. Loading an existing session also preserved the unsent draft in the composer and persisted it after completion. Empty-state bars passed both-theme axe. The isolated packaged process was stopped; the normal development app remains running. No real credentials or paid provider calls were used.

## Session archive export/import (2026-10-20)

Frontend lint, five tests, and production build passed. All 35 Rust tests passed (two existing interactive tests ignored); clippy passed with warnings denied. Archive coverage includes round-trip copies, disabled external inputs, reference-ID remapping, unsafe counter rejection, future schema/malformed document rejection before mutation, failed index-save rollback, bounded file reads, and actual export replacement.

`scripts/native-session-transfer-smoke.mjs` passed against isolated development WebView2 using actual native Save/Open dialogs and owned JSON fixtures: individual export, all-session export, import as copies, preserved draft, cleared screen/repository inclusion, cancellation, unsupported version without mutation, reload persistence, and both-theme axe. The PID/title-scoped UI Automation/Win32 helper only controls the owned file dialogs; no clipboard or provider calls are used. Screenshots `artifacts/session-transfer-dark.png` and `session-transfer-light.png` were visually inspected. An initial outdated test executable lacked the new commands; a premature launch also temporarily blocked Windows from replacing that debug executable. It was stopped, the debug build restarted successfully, and tests reran against the updated app. The dialog helper was then adjusted for filename control initialization and Windows Save/Open control IDs.

The final Windows executable and NSIS installer rebuilt (approximately 3.36 MiB installer). The same native Save/Open dialog smoke passed against the packaged executable, including one/all export, import copies, cancellation, unsupported-version rejection, draft persistence and both-theme accessibility. The isolated packaged app was stopped; the normal development instance remains running. No paid requests or real credential changes were made.
