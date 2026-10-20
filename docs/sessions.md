# Saved sessions

**New session** creates a separate tab and retains the previous session. It initially reuses the repository location, without reusing its captured contents. Each tab has its own goal, draft, conversation, repository selection, references, checkpoint state, and usage counters. Settings and the Windows speech services remain app-wide.

- Switch tabs by clicking or with Left/Right/Home/End when a tab is focused. A model request can finish in its original tab while you work elsewhere. Background replies do not speak or take keyboard focus.
- Close a tab with its × or the Delete key while focused. Closing keeps the saved session in **Session history** (the clock icon). A running request or unfinished voice input must finish or stop before that tab can close.
- History opens saved sessions and offers Rename and Delete. Delete has a separate confirmation with **Keep session** focused by default; Enter keeps it. Deletion removes the record, its previous-save backup, and any quarantined recovery versions. This is distinct from closing a tab.
- Screen/context capture briefly blocks tab changes because it hides the shared app window. Microphone input finishes into its originating session when switching; background voice events are not routed into the new tab. Switching stops spoken output.

## What is saved

CoCo saves goals, drafts, conversation text, repository/reference locations, explicitly pasted reference text, context options, checkpoint numbers, usage counters, tab state, and session names. Common credential patterns are redacted before writing. Form changes save through native IPC as they happen; revision numbers reject out-of-order updates. Completed coaching replies are saved by Rust before returning to the UI. An interrupted model request leaves its question as a draft; CoCo does not resume inference automatically.

Screenshots, repository file contents/diffs, and extracted file/web reference bodies are **not** serialized. They remain in memory while a tab stays open. Closing/reopening a tab or restarting the app requires a fresh context check; file/folder/link references resume as locations with an explicit Refresh notice. Pasted text is saved as user-entered context. Conversation text can itself contain source excerpts or other sensitive information, so review what you share and retain.

Files live in the Tauri app configuration directory under `dev.coco.codecoach/sessions`. They are local JSON, not an encrypted vault or a cloud sync service. OpenAI API keys remain in Windows Credential Manager. `COCO_DATA_DIR` optionally selects an absolute configuration directory (settings plus `sessions/`); this is also used to isolate tests. It does not move existing data or change credential-manager storage.

## Reliability and bounds

Session saves write a same-directory temporary file, flush it, then replace the record. The previous version is kept as `.bak`. One process holds an exclusive store lock. Unreadable session records are preserved; a valid backup is recovered when available, with a visible notice. Recovery copies are named `ID.corrupt-TIMESTAMP.json`. A newer schema is rejected rather than overwritten. An interrupted save can leave the prior complete version; this is not a guarantee against hardware failure or all filesystem corruption.

Save errors remain visible with **Retry save**. Closing/switching/creating sessions waits for current form saves; a failed save blocks those actions rather than discarding the draft. Explicit deletion remains available to help resolve a full store/disk. Do not exit while a save error remains if you need the unsaved changes. App close still hides to the tray; tray Exit is the normal app exit.

The initial implementation supports eight open tabs, 100 saved sessions, up to 2,000 messages and 8 MiB per saved session. Reaching a limit produces an error; it does not silently trim conversation history or delete old sessions. The model still receives only the existing bounded recent history and selected context, rather than the full saved archive. Search, cloud synchronization, and session compaction are future work.

The pre-upgrade single session is handed over locally and imported once. Staging is removed only after native import succeeds. A failed import retains the staged data and reports the problem so it can be retried.

Implementation: `src/Workspace.tsx` coordinates tabs and history; `src/App.tsx` holds each open tab's UI; `src-tauri/src/sessions.rs` owns saved records and independent runtime sessions. Coaching/reference/context commands include the session ID so delayed work cannot attach to another tab.

Rename any open tab using its pencil, double-clicking its title, or pressing F2 when the tab is focused. The name is saved locally and also appears in history. Names may be up to 80 characters; a custom name is retained when the goal changes.

Tabs visually connect to the selected session pane: the active tab shares its background and has an open lower edge, while inactive tabs are recessed. The surrounding frame groups the sidebar and conversation as one session. This replaces the earlier filled-blue active tab styling.

Each saved session now includes its milestone plan/completion states and its context-sidebar width/collapsed preference. See [goal progress and context layout](progress.md).

## Export and import

Open **Session history** (clock icon). Use the download button beside a session to export it, **Export all** for all saved sessions (including closed tabs), or **Import** to choose a CoCo JSON archive. Native Save/Open dialogs select the destination/source. Cancelling changes nothing. Exports wait for pending form saves; finish/stop active work first for a complete snapshot. A successful export is acknowledged only after the file is written.

Archives contain saved goals, custom names, conversations, unsent drafts, milestones/assessment history, reference locations/pasted text, repository location, usage, and layout. They do not bundle repository/reference files, extracted PDF/web bodies, screenshots, provider settings, or stored API keys. Conversation and pasted text may contain sensitive content; common credential patterns are redacted, but archives are unencrypted JSON. Keep them private and review before sharing. Local locations may need adjustment on another machine.

Imports always create new session IDs, so existing sessions remain unchanged and importing the same archive again creates additional copies. The first imported session opens if there is tab capacity; remaining sessions are available in History. With eight tabs already open, all imported sessions stay in History. Repository inclusion and all imported references start disabled; screen selection is cleared. Review locations and choose a valid screen before capturing or refreshing context. No linked file/page is read during import and no model request is made.

The portable format is `{ "format": "coco.sessions", "version": 1, "sessions": [...] }`, using the versioned saved-session schema. Limits: 32 MiB per archive, 8 MiB per session, and 100 total saved sessions after import. Every session is validated before any are saved; invalid/unsupported archives or a capacity failure import nothing. Save errors roll back newly created session records and retain the prior tab index. A crash/power failure during a multi-file import can still leave complete new records recoverable by the existing startup logic; filesystem writes are not a single multi-file transaction.
