import { useCallback, useEffect, useRef, useState } from "react";
import {
  History,
  X,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import App, { Modal } from "./App";
import { call, native } from "./bridge";
import { defaults, emptyContext } from "./types";
import type {
  SavedSession,
  SessionForm,
  SessionSummary,
  SessionView,
  Settings,
  WorkspaceState,
} from "./types";
import { errorText } from "./lib";
import { upgradeKey } from "./upgrade";

function emptyDocument(): SavedSession {
  const now = Date.now();
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "New session",
    customTitle: false,
    goal: "",
    draft: "",
    root: null,
    sourceId: "",
    includeScreen: true,
    includeRepo: true,
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, requests: 0 },
    references: [],
    createdAt: now,
    updatedAt: now,
    formRevision: 0,
    lastCheckpoint: 0,
    milestones: [],
    automaticProgress: true,
    progressEpoch: 0,
    progressHistory: [],
    progressNotice: "",
    contextWidth: 278,
    contextCollapsed: false,
  };
}
export default function Workspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const [settings, setSettings] = useState<Settings>(defaults);
  const [status, setStatus] = useState<
    Record<string, { phase: string; voice: string }>
  >({});
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(0);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState(false);
  const [rename, setRename] = useState<SessionSummary | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<Record<string, Promise<unknown>>>({});
  const forms = useRef<Record<string, SessionForm>>({});
  const saveErrors = useRef<Record<string, string>>({});
  const actionBusy = useRef(false);
  const loadedViews = useRef<Record<string, SessionView>>({});
  const captured = Object.values(status).some((s) => s.phase === "capturing");
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String((settings.textSize ?? 100) / 100),
    );
    document.documentElement.style.fontSize = `${(16 * (settings.textSize ?? 100)) / 100}px`;
  }, [settings.textSize]);

  const apply = useCallback(async (next: WorkspaceState) => {
    const nextViews: Record<string, SessionView> = {};
    for (const id of next.openIds)
      nextViews[id] =
        loadedViews.current[id] ??
        (await call<SessionView>("get_session", { id }));
    loadedViews.current = nextViews;
    setViews(nextViews);
    setWorkspace(next);
  }, []);
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        if (!native) {
          const document = emptyDocument();
          if (mounted) {
            setViews({
              [document.id]: {
                document,
                context: emptyContext,
                references: [],
              },
            });
            setWorkspace({
              sessions: [
                {
                  id: document.id,
                  title: document.title,
                  updatedAt: document.updatedAt,
                  open: true,
                },
              ],
              openIds: [document.id],
              activeId: document.id,
              warning: "",
            });
          }
          return;
        }
        let next = await call<WorkspaceState>("load_workspace");
        const staged = localStorage.getItem(upgradeKey);
        try {
          if (staged) {
            const value = JSON.parse(staged) as Partial<SavedSession>;
            if (
              value.goal ||
              value.draft ||
              value.root ||
              value.messages?.length ||
              value.references?.length
            ) {
              // Keep a stable import ID until the import is committed, so a restart cannot duplicate it.
              const document = {
                ...emptyDocument(),
                ...value,
                version: 1,
                id: value.id || crypto.randomUUID(),
              };
              localStorage.setItem(upgradeKey, JSON.stringify(document));
              next = await call<WorkspaceState>("import_session", { document });
            }
            localStorage.removeItem(upgradeKey);
          }
        } catch (e) {
          if (mounted)
            setError(
              `The previous session remains staged locally but could not be imported: ${errorText(e)}. Resolve the error and reload to retry.`,
            );
        }
        const value = await call<Settings>("load_settings");
        if (mounted) {
          setSettings({
            ...defaults,
            ...value,
            speech: value.speech ?? defaults.speech,
          });
          await apply(next);
        }
      } catch (e) {
        if (mounted)
          setError(`Session history could not be opened: ${errorText(e)}`);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [apply]);

  const onForm = useCallback((id: string, form: SessionForm): Promise<void> => {
    forms.current[id] = form;
    setSaving((n) => n + 1);
    const promise = call<SessionSummary>("save_session_form", { id, form })
      .then((summary) => {
        setWorkspace((current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((s) =>
                  s.id === id ? summary : s,
                ),
              }
            : current,
        );
        delete saveErrors.current[id];
        setSaveError(Object.values(saveErrors.current)[0] || "");
      })
      .catch((e) => {
        saveErrors.current[id] = errorText(e);
        setSaveError(errorText(e));
        throw e;
      })
      .finally(() => setSaving((n) => n - 1));
    pending.current[id] = promise;
    return promise;
  }, []);
  const onStatus = useCallback((id: string, phase: string, voice: string) => {
    setStatus((current) =>
      current[id]?.phase === phase && current[id]?.voice === voice
        ? current
        : { ...current, [id]: { phase, voice } },
    );
  }, []);
  async function action(command: string, id?: string, name?: string) {
    if (actionBusy.current || captured) return;
    actionBusy.current = true;
    setActing(true);
    setError("");
    try {
      const writes = await Promise.allSettled(Object.values(pending.current));
      const failed = writes.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failed && command !== "delete") throw failed.reason;
      await call("stop_speaking");
      const next = await call<WorkspaceState>("session_action", {
        action: command,
        id: id ?? null,
        title: name ?? null,
      });
      await apply(next);
      for (const key of Object.keys(pending.current)) {
        if (!next.openIds.includes(key)) {
          delete pending.current[key];
          delete forms.current[key];
          delete saveErrors.current[key];
        }
      }
      setHistory(false);
      setRename(null);
      setDeleting(null);
    } catch (e) {
      setError(errorText(e));
      try {
        await apply(await call<WorkspaceState>("load_workspace"));
      } catch {
        /* Preserve the visible session if storage is unavailable. */
      }
    } finally {
      actionBusy.current = false;
      setActing(false);
    }
  }
  function isBusy(id: string) {
    return (
      status[id] && (status[id].phase !== "idle" || status[id].voice !== "idle")
    );
  }
  async function retry() {
    for (const [id, form] of Object.entries(forms.current)) {
      try {
        await onForm(id, form);
      } catch {
        return;
      }
    }
  }
  if (!workspace)
    return (
      <div className="workspace-loading" role="status">
        {error || "Opening session history…"}
      </div>
    );
  const active = workspace.activeId;
  return (
    <main className="workspace-shell" aria-label="Code Coach workspace">
      <div className="workspace-tabs">
        <div
          role="tablist"
          aria-label="Sessions"
          className="session-tabs"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const current = workspace.openIds.indexOf(active);
            const index =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? workspace.openIds.length - 1
                  : (current +
                      (e.key === "ArrowRight" ? 1 : -1) +
                      workspace.openIds.length) %
                    workspace.openIds.length;
            const id = workspace.openIds[index];
            void action("activate", id).then(() =>
              document.getElementById(`tab-${id}`)?.focus(),
            );
          }}
        >
          {workspace.openIds.map((id) => {
            const summary = workspace.sessions.find((s) => s.id === id);
            return (
              <div
                className={`session-tab ${id === active ? "selected" : ""}`}
                key={id}
              >
                <button
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={id === active}
                  aria-controls={`panel-${id}`}
                  tabIndex={id === active ? 0 : -1}
                  disabled={acting || captured}
                  title={`${summary?.title || "New session"} · Double-click or press F2 to rename`}
                  aria-keyshortcuts="Delete F2"
                  aria-description="Press F2 to rename or Delete to close this tab. Its saved session remains in history."
                  onDoubleClick={() => {
                    if (summary) {
                      setRename(summary);
                      setTitle(summary.title);
                    }
                  }}
                  onClick={() => {
                    if (id !== active) void action("activate", id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "F2" && summary) {
                      e.preventDefault();
                      setRename(summary);
                      setTitle(summary.title);
                    }
                    if (
                      e.key === "Delete" &&
                      !isBusy(id) &&
                      !acting &&
                      !captured
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      void action("close", id);
                    }
                  }}
                >
                  {status[id]?.phase === "thinking" && (
                    <LoaderCircle size={12} className="spin" />
                  )}
                  <span>{summary?.title || "New session"}</span>
                  <span
                    className="tab-rename"
                    aria-hidden="true"
                    title="Rename session (F2)"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (summary) {
                        setRename(summary);
                        setTitle(summary.title);
                      }
                    }}
                  >
                    <Pencil size={13} />
                  </span>
                  <span
                    className={`tab-close ${isBusy(id) ? "disabled" : ""}`}
                    aria-hidden="true"
                    title={
                      isBusy(id)
                        ? "Finish this session’s request or voice input before closing"
                        : "Close tab (keeps saved history)"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!acting && !captured && !isBusy(id))
                        void action("close", id);
                    }}
                  >
                    <X size={13} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <span
          className={`save-state ${saveError ? "failed" : ""}`}
          role="status"
        >
          {saveError
            ? "Not saved"
            : native
              ? saving
                ? "Saving…"
                : "Saved locally"
              : "Preview"}
        </span>
        <button
          className="icon-button"
          aria-label="Session history"
          title="Session history"
          disabled={acting || captured || !native}
          onClick={() => setHistory(true)}
        >
          <History size={17} />
        </button>
      </div>
      {(error || saveError || workspace.warning) && (
        <div className="workspace-notice" role="alert">
          {error || saveError || workspace.warning}
          {saveError && (
            <button className="text-button" onClick={() => void retry()}>
              Retry save
            </button>
          )}
        </div>
      )}
      {workspace.openIds.map(
        (id) =>
          views[id] && (
            <div
              className="session-view"
              role="tabpanel"
              id={`panel-${id}`}
              aria-labelledby={`tab-${id}`}
              hidden={id !== active}
              key={id}
            >
              <App
                initial={views[id]}
                active={id === active}
                sessionTitle={
                  workspace.sessions.find((s) => s.id === id)?.title ||
                  "New session"
                }
                sharedSettings={settings}
                onSettings={setSettings}
                onNewSession={() => void action("new", id)}
                onForm={onForm}
                onStatus={onStatus}
              />
            </div>
          ),
      )}
      {history && (
        <Modal title="Session history" wide onClose={() => setHistory(false)}>
          <div className="history-body">
            <p className="field-note">
              Closing a tab keeps its saved session here. Delete permanently
              removes it.
            </p>
            {workspace.sessions
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((s) => (
                <div className="history-row" key={s.id}>
                  <button
                    className="history-open"
                    disabled={acting || captured}
                    onClick={() => void action("open", s.id)}
                  >
                    <span>{s.title}</span>
                    <small>
                      {new Date(s.updatedAt).toLocaleString()}
                      {s.open ? " · Open" : ""}
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Rename ${s.title}`}
                    onClick={() => {
                      setRename(s);
                      setTitle(s.title);
                      setHistory(false);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${s.title}`}
                    disabled={isBusy(s.id)}
                    onClick={() => {
                      setDeleting(s);
                      setHistory(false);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </div>
        </Modal>
      )}
      {rename && (
        <Modal title="Rename session" onClose={() => setRename(null)}>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("rename", rename.id, title);
            }}
          >
            <div className="field">
              <label htmlFor="session-name">Session name</label>
              <input
                id="session-name"
                autoFocus
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setRename(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={acting || !title.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete saved session?"
          initialFocusRef={keepRef}
          onClose={() => setDeleting(null)}
        >
          <div className="settings-form">
            <p className="field-note">
              “{deleting.title}” and its saved conversation will be permanently
              removed. This cannot be undone.
            </p>
            <div className="modal-footer">
              <button
                ref={keepRef}
                className="button primary"
                onClick={() => setDeleting(null)}
                disabled={acting}
              >
                Keep session
              </button>
              <button
                className="button secondary"
                disabled={acting}
                onClick={() => void action("delete", deleting.id)}
              >
                Delete session
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
