import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Circle,
  Code2,
  Copy,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Menu,
  Mic,
  Monitor,
  Moon,
  Pin,
  Paperclip,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  Square,
  Sun,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { call as invokeNative, native, subscribe } from "./bridge";
import { emptyContext } from "./types";
import type {
  Answer,
  Context,
  Message,
  Settings,
  Source,
  Usage,
  VoiceEvent,
  Reference,
  SessionView,
  SessionForm,
} from "./types";
import { errorText, folderName, speechText, tokens } from "./lib";
import {
  compatibleModels,
  knownIncompatible,
  reasoningEfforts,
  compatibleEffort,
} from "./models";
import type { Model } from "./types";
import type { Milestone, ProgressState, ProgressCheckpoint } from "./types";
import Milestones from "./Milestones";
import ProgressVisual from "./ProgressVisual";
const call = invokeNative;

type Phase = "idle" | "capturing" | "thinking";
type VoicePhase = "idle" | "starting" | "listening" | "finishing";

function Mark({ large = false }: { large?: boolean }) {
  return (
    <span className={`mark ${large ? "large" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path d="M17 8a12 12 0 1 0 0 24M28 12a8 8 0 1 0 0 16" />
        <circle cx="34" cy="20" r="2.3" />
      </svg>
    </span>
  );
}
function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export default function App({
  initial,
  active,
  sessionTitle,
  sharedSettings,
  onSettings,
  onNewSession,
  onForm,
  onStatus,
}: {
  initial: SessionView;
  active: boolean;
  sessionTitle: string;
  sharedSettings: Settings;
  onSettings: (value: Settings) => void;
  onNewSession: () => void;
  onForm: (id: string, form: SessionForm) => Promise<void>;
  onStatus: (id: string, phase: Phase, voice: VoicePhase) => void;
}) {
  const sessionKey = initial.document.id;
  const call = useCallback(
    <T,>(command: string, args?: Record<string, unknown>) =>
      invokeNative<T>(command, { ...args, sessionId: sessionKey }),
    [sessionKey],
  );
  const activeRef = useRef(active);
  const formRevision = useRef(initial.document.formRevision);
  const [settings, setSettings] = useState<Settings>(sharedSettings);
  const [goal, setGoal] = useState(initial.document.goal);
  const [milestones, setMilestones] = useState<Milestone[]>(
    initial.document.milestones ?? [],
  );
  const [automaticProgress, setAutomaticProgress] = useState(
    initial.document.automaticProgress ?? true,
  );
  const [progressEpoch, setProgressEpoch] = useState(
    initial.document.progressEpoch ?? 0,
  );
  const [progressHistory, setProgressHistory] = useState<ProgressCheckpoint[]>(
    initial.document.progressHistory ?? [],
  );
  const [progressNotice, setProgressNotice] = useState(
    initial.document.progressNotice ?? "",
  );
  const applyProgress = useCallback((state: ProgressState) => {
    setMilestones(state.milestones);
    setAutomaticProgress(state.automatic);
    setProgressEpoch(state.epoch);
    setProgressHistory(state.history);
    setProgressNotice(state.notice);
  }, []);
  const [showMilestones, setShowMilestones] = useState(false);
  const [contextWidth, setContextWidth] = useState(
    initial.document.contextWidth ?? 278,
  );
  const [contextCollapsed, setContextCollapsed] = useState(
    initial.document.contextCollapsed ?? false,
  );
  const shell = useRef<HTMLDivElement>(null);
  const dragWidth = useRef(contextWidth);
  const completed = milestones.filter((m) => m.done).length;
  const [root, setRoot] = useState<string | null>(initial.document.root);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState(initial.document.sourceId);
  const [includeScreen, setIncludeScreen] = useState(
    initial.document.includeScreen,
  );
  const [includeRepo, setIncludeRepo] = useState(initial.document.includeRepo);
  const [context, setContext] = useState<Context>(initial.context);
  const [messages, setMessages] = useState<Message[]>(
    initial.document.messages,
  );
  const [draft, setDraft] = useState(initial.document.draft);
  const [phase, setPhase] = useState<Phase>("idle");
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<Usage>(initial.document.usage);
  const [showSettings, setShowSettings] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [references, setReferences] = useState<Reference[]>(initial.references);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState("");
  const [warning, setWarning] = useState("");
  const [resolvedTheme, setResolvedTheme] = useState("dark");
  const busy = useRef(false);
  const cancelled = useRef(false);
  const voiceId = useRef(0);
  const voiceTarget = useRef<"goal" | "message">("message");
  const sessionId = useRef(0);
  const messageEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const goalInput = useRef<HTMLTextAreaElement>(null);
  const actions = useRef<{ capture: () => void; voice: () => void }>({
    capture: () => {},
    voice: () => {},
  });
  const settingsOpen = useRef(false);

  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active && (voicePhase === "starting" || voicePhase === "listening")) {
      setVoicePhase("finishing");
      void call("stop_voice", { cancel: false });
    }
  }, [active, voicePhase, call]);
  useEffect(() => setSettings(sharedSettings), [sharedSettings]);
  useEffect(() => {
    onStatus(sessionKey, phase, voicePhase);
  }, [sessionKey, phase, voicePhase, onStatus]);
  useEffect(() => {
    if (!native) return;
    void onForm(sessionKey, {
      milestones,
      automaticProgress,
      progressEpoch,
      contextWidth,
      contextCollapsed,
      goal,
      draft,
      sourceId,
      includeScreen,
      includeRepo,
      pending: phase !== "idle",
      revision: ++formRevision.current,
    }).catch(() => {});
  }, [
    milestones,
    automaticProgress,
    progressEpoch,
    contextWidth,
    contextCollapsed,
    goal,
    draft,
    sourceId,
    includeScreen,
    includeRepo,
    references,
    phase,
    onForm,
    sessionKey,
  ]);
  const refreshSources = useCallback(async () => {
    try {
      const result = await call<Source[]>("list_sources");
      setSources(result);
      setSourceId((current) =>
        result.some((s) => s.id === current)
          ? current
          : current
            ? ""
            : result[0]?.id || "",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }, [call]);

  useEffect(() => {
    let active = true;
    void refreshSources();
    void call<Reference[]>("list_references")
      .then((items) => {
        if (active) setReferences(items);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    void call<{ recognizers: string[] }>("voice_status")
      .then((value) => {
        if (active) setVoiceAvailable(value.recognizers.length > 0);
      })
      .catch(() => {
        if (active) setVoiceAvailable(false);
      });
    void call<string[]>("shortcut_warnings").then((value) => {
      if (active && value.length)
        setWarning(
          `Shortcut unavailable: ${value.join(", ")}. Use the buttons instead.`,
        );
    });
    return () => {
      active = false;
    };
  }, [refreshSources, call]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme;
      document.documentElement.dataset.theme = theme;
      setResolvedTheme(theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const request = useCallback(
    async (refresh: boolean, override?: string) => {
      if (busy.current || settingsOpen.current) return;
      if (!native) {
        setError("Open the CoCo desktop app to begin a session.");
        return;
      }
      if (!goal.trim()) {
        setError("Set a goal for this session first.");
        if (activeRef.current) goalInput.current?.focus();
        return;
      }
      if (
        !settings.model.trim() ||
        (settings.provider === "openai" && !settings.hasApiKey)
      ) {
        setShowSettings(true);
        return;
      }
      if (voicePhase !== "idle") {
        setError("Finish voice input before asking the coach.");
        return;
      }
      if (refresh && includeScreen && !sourceId) {
        setError("Choose a screen or window, or turn screen capture off.");
        return;
      }
      busy.current = true;
      cancelled.current = false;
      const currentSession = sessionId.current;
      setError("");
      const question =
        (override ?? draft).trim() ||
        (messages.length
          ? "Check my progress and guide me to the next step."
          : "Help me get started with this goal. Give me the first step.");
      let checkpoint = context.number;
      let pendingMessageId: string | null = null;
      try {
        await onForm(sessionKey, {
          goal,
          draft: question,
          sourceId,
          includeScreen,
          includeRepo,
          milestones,
          automaticProgress,
          progressEpoch,
          contextWidth,
          contextCollapsed,
          pending: true,
          revision: ++formRevision.current,
        });
        await call("stop_speaking");
        if (refresh) {
          setPhase("capturing");
          const next = await call<Context>("refresh_context", {
            goal,
            query: question,
            sourceId: includeScreen ? sourceId : null,
            includeRepository: includeRepo && !!root,
          });
          if (sessionId.current !== currentSession) return;
          setContext(next);
          checkpoint = next.number;
        }
        if (cancelled.current) throw new Error("Request cancelled.");
        setPhase("thinking");
        pendingMessageId = crypto.randomUUID();
        const messageId = pendingMessageId;
        setMessages((current) => [
          ...current,
          {
            id: messageId,
            role: "user",
            text: question,
            checkpoint,
            time: Date.now(),
          },
        ]);
        if (!override) setDraft("");
        const answer = await call<Answer>("ask_coach", {
          goal,
          question,
          assessmentCheckpoint: refresh ? checkpoint : null,
          useScreen: includeScreen,
          useRepository: includeRepo && !!root,
        });
        if (sessionId.current !== currentSession) return;
        setMessages(
          (current) =>
            answer.messages ?? [
              ...current,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                text: answer.text,
                checkpoint,
                time: Date.now(),
              },
            ],
        );
        setUsage((current) => ({
          inputTokens: current.inputTokens + answer.usage.inputTokens,
          outputTokens: current.outputTokens + answer.usage.outputTokens,
          requests: current.requests + 1,
        }));
        if (answer.progress) applyProgress(answer.progress);
        if (answer.saveError) setError(answer.saveError);
        if (settings.speakAnswers && activeRef.current)
          void call("speak", {
            text: speechText(answer.text).slice(0, 900),
          }).catch((e) => setError(errorText(e)));
      } catch (e) {
        if (sessionId.current === currentSession) {
          setMessages((current) =>
            current.filter((message) => message.id !== pendingMessageId),
          );
          setError(errorText(e));
          setDraft(override ? draft : question);
        }
      } finally {
        if (sessionId.current === currentSession) {
          setPhase("idle");
          busy.current = false;
          if (activeRef.current) composer.current?.focus();
        }
      }
    },
    [
      applyProgress,
      onForm,
      sessionKey,
      milestones,
      automaticProgress,
      progressEpoch,
      contextWidth,
      contextCollapsed,
      call,
      goal,
      settings,
      voicePhase,
      includeScreen,
      sourceId,
      draft,
      messages.length,
      context.number,
      includeRepo,
      root,
    ],
  );

  const toggleVoice = useCallback(async () => {
    if (busy.current || settingsOpen.current) return;
    setError("");
    try {
      if (voicePhase === "idle") {
        voiceTarget.current =
          !goal.trim() ||
          (document.activeElement === goalInput.current && !messages.length)
            ? "goal"
            : "message";
        setVoicePhase("starting");
        const id = await call<number>("start_voice");
        voiceId.current = id;
      } else if (voicePhase === "listening" || voicePhase === "starting") {
        setVoicePhase("finishing");
        await call("stop_voice", { cancel: false });
      }
    } catch (e) {
      setVoicePhase("idle");
      setError(errorText(e));
    }
  }, [call, voicePhase, goal, messages.length]);

  useEffect(() => {
    actions.current = {
      capture: () => {
        void request(true);
      },
      voice: () => {
        void toggleVoice();
      },
    };
  }, [request, toggleVoice]);
  useEffect(() => {
    settingsOpen.current = showSettings || showContext || showReferences;
  }, [showSettings, showContext, showReferences]);
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    void subscribe<string>("coco-shortcut", (action) => {
      if (!activeRef.current) return;
      if (action === "voice") actions.current.voice();
      else actions.current.capture();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void subscribe<VoiceEvent>("voice-event", (event) => {
      if (event.id !== voiceId.current) return;
      if (event.kind === "ready")
        setVoicePhase((current) =>
          current === "finishing" ? current : "listening",
        );
      if (event.kind === "result") {
        setVoicePhase("idle");
        if (event.text.trim()) {
          if (voiceTarget.current === "goal") {
            setGoal((current) =>
              `${current}${current ? " " : ""}${event.text}`.slice(0, 4000),
            );
            if (activeRef.current) goalInput.current?.focus();
          } else {
            setDraft((current) =>
              `${current}${current ? " " : ""}${event.text}`.slice(0, 12000),
            );
            if (activeRef.current) composer.current?.focus();
          }
        } else
          setError("No speech recognized. Try again or type your question.");
      }
      if (event.kind === "error") {
        setVoicePhase("idle");
        setError(event.text);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  async function chooseRepo() {
    if (busy.current) return;
    try {
      const path = await call<string | null>("pick_repository");
      if (path && path !== root) {
        sessionId.current++;
        setRoot(path);
        setContext(emptyContext);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function themeToggle() {
    const next = {
      ...settings,
      theme: resolvedTheme === "dark" ? ("light" as const) : ("dark" as const),
    };
    setSettings(next);
    onSettings(next);
    if (native)
      try {
        await call("save_settings", {
          settings: next,
          apiKey: null,
          clearKey: false,
        });
      } catch (e) {
        setError(errorText(e));
      }
  }
  async function pin() {
    if (!native) return;
    try {
      await getCurrentWindow().setAlwaysOnTop(!pinned);
      setPinned(!pinned);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const timestamp = context.capturedAt
    ? new Date(context.capturedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const isBusy = phase !== "idle";

  return (
    <div
      className={`app-shell ${contextCollapsed ? "context-collapsed" : ""}`}
      ref={shell}
      style={{ "--context-width": `${contextWidth}px` } as React.CSSProperties}
    >
      <aside
        className="sidebar"
        id={`${sessionKey}-context`}
        role="region"
        aria-label="Session controls"
        hidden={contextCollapsed}
      >
        <header className="brand">
          <div className="brand-name">
            <Mark />
            <span>CoCo</span>
          </div>
          <button
            className="icon-button"
            title="New session"
            aria-label="New session"
            disabled={phase === "capturing"}
            onClick={onNewSession}
          >
            <Plus size={18} />
          </button>
        </header>
        <div className="session-controls">
          <label className="field-label" htmlFor={`${sessionKey}-goal`}>
            What are we working on?
          </label>
          <textarea
            ref={goalInput}
            id={`${sessionKey}-goal`}
            className="goal-input"
            value={goal}
            maxLength={4000}
            disabled={isBusy || messages.length > 0}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Fix a failing test, understand a codebase, build something…"
            rows={4}
          />
          {messages.length > 0 && (
            <p className="field-note">
              Start a new session to change the goal.
            </p>
          )}
          <div className="context-section">
            <div className="section-row">
              <span>Repository</span>
              {root && (
                <Toggle
                  checked={includeRepo}
                  onChange={setIncludeRepo}
                  label="Include repository context"
                  disabled={isBusy}
                />
              )}
            </div>
            <button
              className={`repo-picker ${root ? "selected" : ""}`}
              disabled={isBusy}
              onClick={() => void chooseRepo()}
              title={root || undefined}
            >
              <FolderOpen size={19} />
              <span>
                {root ? folderName(root) : "Choose a folder"}
                <small>{root ? root : "Optional · read-only access"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {root && (
              <button
                className="text-button remove-repo"
                disabled={isBusy}
                onClick={() => {
                  void call("detach_repository")
                    .then(() => {
                      sessionId.current++;
                      setRoot(null);
                      setContext(emptyContext);
                    })
                    .catch((e) => setError(errorText(e)));
                }}
              >
                Remove repository
              </button>
            )}
          </div>
          <div className="context-section">
            <div className="section-row">
              <span>Screen</span>
              <Toggle
                checked={includeScreen}
                onChange={setIncludeScreen}
                label="Include screen capture"
                disabled={isBusy}
              />
            </div>
            {includeScreen && (
              <div className="source-row">
                <Monitor size={16} />
                <select
                  aria-label="Capture source"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  disabled={isBusy || !sources.length}
                >
                  {!sources.length && (
                    <option value="">
                      {native ? "No sources found" : "Desktop app required"}
                    </option>
                  )}
                  {sources.length > 0 && (
                    <option value="">Choose a screen or window</option>
                  )}
                  {sources.map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button small"
                  aria-label="Refresh capture sources"
                  title="Refresh sources"
                  disabled={isBusy || !native}
                  onClick={() => void refreshSources()}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            <p className="field-note">
              Captured only when you ask for a fresh check.
            </p>
          </div>
          <div className="context-section">
            <button
              className="repo-picker"
              onClick={() => setShowReferences(true)}
              disabled={isBusy}
            >
              <Paperclip size={19} />
              <span>
                References
                <small>
                  {references.length
                    ? `${references.filter((r) => r.enabled).length} included · ${references.length} attached`
                    : "Files, folders, links, or pasted text"}
                </small>
              </span>
              <Plus size={15} />
            </button>
          </div>
          <div className="checkpoint">
            <div className="section-row">
              <span className="checkpoint-title">
                <Circle
                  size={7}
                  fill={context.number ? "var(--success)" : "currentColor"}
                />
                {context.number
                  ? `Checkpoint ${String(context.number).padStart(2, "0")}`
                  : "No checkpoint yet"}
              </span>
              {context.number > 0 && <span className="muted">{timestamp}</span>}
            </div>
            {context.number > 0 ? (
              <>
                <div className="checkpoint-stats">
                  {context.repository && (
                    <span>
                      {context.repository.fileCount} files ·{" "}
                      {context.repository.changes.length} changed
                    </span>
                  )}
                  {context.screen && (
                    <span>
                      {context.screen.width} × {context.screen.height}
                    </span>
                  )}
                </div>
                <button
                  className="text-button"
                  onClick={() => setShowContext(true)}
                >
                  Inspect shared context <span aria-hidden="true">↗</span>
                </button>
              </>
            ) : (
              <p className="field-note">
                {messages.length
                  ? "Resume with a fresh check. Refresh file and link references before relying on them."
                  : "Your first check creates a context snapshot."}
              </p>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="settings-button"
            onClick={() => setShowSettings(true)}
            disabled={isBusy}
          >
            <Settings2 size={17} />
            <span>Settings</span>
            <span className="provider-label">
              {settings.provider === "ollama" ? "Ollama" : "OpenAI"}
            </span>
          </button>
        </div>
      </aside>
      <div
        className="context-splitter"
        role="separator"
        aria-label="Resize context panel"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={480}
        aria-valuenow={contextWidth}
        aria-controls={`${sessionKey}-context`}
        tabIndex={contextCollapsed ? -1 : 0}
        hidden={contextCollapsed}
        onPointerDown={(e) => {
          dragWidth.current = contextWidth;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId) && shell.current) {
            const box = shell.current.getBoundingClientRect();
            dragWidth.current = Math.round(
              Math.max(
                220,
                Math.min(480, box.width * 0.45, e.clientX - box.left),
              ),
            );
            shell.current.style.setProperty(
              "--context-width",
              `${dragWidth.current}px`,
            );
          }
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setContextWidth(dragWidth.current);
          }
        }}
        onPointerCancel={() => {
          shell.current?.style.setProperty(
            "--context-width",
            `${contextWidth}px`,
          );
        }}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            const max = Math.min(
              480,
              Math.floor((shell.current?.clientWidth ?? 1067) * 0.45),
            );
            setContextWidth(
              e.key === "Home"
                ? 220
                : e.key === "End"
                  ? max
                  : Math.max(
                      220,
                      Math.min(
                        max,
                        contextWidth + (e.key === "ArrowRight" ? 10 : -10),
                      ),
                    ),
            );
          }
        }}
        onDoubleClick={() => setContextWidth(278)}
        title="Drag to resize · Arrow keys adjust · Double-click to reset"
      />
      <section className="main-pane" aria-label="Conversation">
        <header className="main-header">
          <div className="header-title">
            <button
              className="icon-button"
              aria-label={
                contextCollapsed
                  ? "Expand context panel"
                  : "Collapse context panel"
              }
              aria-expanded={!contextCollapsed}
              aria-controls={`${sessionKey}-context`}
              title={
                contextCollapsed
                  ? "Expand context panel"
                  : "Collapse context panel"
              }
              onClick={() => setContextCollapsed(!contextCollapsed)}
            >
              <Menu size={18} />
            </button>
            <h1 className="header-name" title={sessionTitle}>
              {sessionTitle}
            </h1>
          </div>
          <div className="header-actions">
            {contextCollapsed && (
              <>
                <button
                  className="icon-button"
                  aria-label="New session"
                  title="New session"
                  disabled={phase === "capturing"}
                  onClick={onNewSession}
                >
                  <Plus size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Settings"
                  title="Settings"
                  onClick={() => setShowSettings(true)}
                >
                  <Settings2 size={18} />
                </button>
              </>
            )}
            <button
              className={`icon-button ${pinned ? "active" : ""}`}
              aria-label="Keep on top"
              aria-pressed={pinned}
              title="Keep on top"
              onClick={() => void pin()}
            >
              <Pin size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
              title="Switch theme"
              onClick={() => void themeToggle()}
            >
              {resolvedTheme === "dark" ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </button>
          </div>
        </header>
        <div className="goal-progress">
          <ProgressVisual items={milestones} history={progressHistory} />
          <button
            className="progress-open"
            title={
              milestones.length
                ? "View session progress"
                : "Load progress from this session’s goal and conversation"
            }
            aria-description="View checkpoints derived from the session plan"
            disabled={isBusy || !goal.trim()}
            onClick={() =>
              milestones.length
                ? setShowMilestones(true)
                : void request(
                    false,
                    "Derive the checkpoints from our established goal and plan, assess current progress using our saved conversation and available evidence, and tell me the next step. If we have no established plan, propose one specific to this goal.",
                  )
            }
          >
            {milestones.length ? (
              <>
                <span>
                  {completed} of {milestones.length} milestones complete
                </span>
                {milestones.some((m) => !m.done) && (
                  <span className="progress-next">
                    Next: {milestones.find((m) => !m.done)?.title}
                  </span>
                )}
              </>
            ) : (
              <span>
                {isBusy
                  ? "Assessing session progress…"
                  : goal.trim()
                    ? "Load session progress"
                    : "Set a goal to track progress"}
              </span>
            )}
          </button>
        </div>
        {progressNotice && (
          <p className="progress-notice" role="status">
            {progressNotice}
          </p>
        )}
        {!native && (
          <div className="preview-banner">
            Browser preview · use the desktop app for screen, repository, and
            voice.
          </div>
        )}
        {warning && <div className="notice">{warning}</div>}
        <div
          className="conversation"
          aria-label="Conversation"
          aria-busy={isBusy}
        >
          {messages.length === 0 && (
            <div className="empty-state">
              <Mark large />
              <h2>
                A little clarity.
                <br />
                Your next step.
              </h2>
              <p>
                Bring your code, share your screen,
                <br />
                and work through it together.
              </p>
              <div className="starter-list">
                {[
                  {
                    icon: Code2,
                    text: "Understand this codebase",
                    goal: "Help me understand the architecture and main execution flow of this codebase.",
                  },
                  {
                    icon: ScanLine,
                    text: "Work through a bug",
                    goal: "Help me investigate and fix a bug, one step at a time.",
                  },
                ].map((item) => (
                  <button
                    key={item.text}
                    onClick={() => {
                      setGoal(item.goal);
                      if (activeRef.current) goalInput.current?.focus();
                    }}
                  >
                    <item.icon size={17} />
                    <span>{item.text}</span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-avatar">
                {message.role === "assistant" ? <Mark /> : <span>You</span>}
              </div>
              <div className="message-body">
                <div className="message-heading">
                  <strong>
                    {message.role === "assistant" ? "CoCo" : "You"}
                  </strong>
                  <span>
                    {message.checkpoint
                      ? `Checkpoint ${String(message.checkpoint).padStart(2, "0")}`
                      : "Conversation only"}
                  </span>
                </div>
                <div className="markdown">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) =>
                      /^https?:\/\//i.test(url) ? url : ""
                    }
                    components={{
                      a: ({ children }) => <span>{children}</span>,
                      code: ({ children, className }) => (
                        <code className={className}>{children}</code>
                      ),
                    }}
                  >
                    {message.text}
                  </Markdown>
                </div>
                {message.role === "assistant" && (
                  <div className="message-actions">
                    <button
                      className="icon-button small"
                      title="Copy response"
                      aria-label="Copy response"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(message.text)
                          .then(() => {
                            setCopied(message.id);
                            window.setTimeout(() => setCopied(""), 1500);
                          })
                          .catch((e) => setError(errorText(e)));
                      }}
                    >
                      {copied === message.id ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      className="icon-button small"
                      title="Read aloud"
                      aria-label="Read response aloud"
                      onClick={() => {
                        void call("speak", {
                          text: speechText(message.text),
                        }).catch((e) => setError(errorText(e)));
                      }}
                    >
                      <Volume2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {isBusy && (
            <div className="thinking" role="status">
              <Mark />
              <span>
                {phase === "capturing"
                  ? "Taking a fresh look…"
                  : "Finding your next step…"}
              </span>
              <LoaderCircle className="spin" size={15} />
            </div>
          )}
          <div ref={messageEnd} />
        </div>
        <div className="composer-area">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button small"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <form
            className={`composer ${voicePhase !== "idle" ? "recording" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              void request(context.number === 0);
            }}
          >
            <textarea
              ref={composer}
              aria-label="Message CoCo"
              placeholder={
                voicePhase === "listening"
                  ? "Listening… finish speaking to review your words."
                  : "Ask a question, or tell me where you’re stuck…"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={12000}
              rows={2}
              disabled={isBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void request(context.number === 0);
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  type="button"
                  className={`icon-button ${voicePhase !== "idle" ? "recording-button" : ""}`}
                  disabled={
                    !voiceAvailable || isBusy || voicePhase === "finishing"
                  }
                  title={
                    voiceAvailable
                      ? "Start / finish voice input · Ctrl+Shift+Space"
                      : "Windows speech recognition is unavailable"
                  }
                  aria-label={
                    voicePhase === "idle"
                      ? "Start voice input"
                      : "Finish voice input"
                  }
                  onClick={() => void toggleVoice()}
                >
                  {voicePhase === "starting" || voicePhase === "finishing" ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : voicePhase === "listening" ? (
                    <Square size={16} />
                  ) : (
                    <Mic size={18} />
                  )}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Stop speech"
                  title="Stop speech"
                  onClick={() => {
                    void call("stop_speaking");
                  }}
                >
                  <VolumeX size={18} />
                </button>
                <span className="composer-hint">
                  {voicePhase === "starting"
                    ? "Preparing microphone…"
                    : voicePhase === "listening"
                      ? "Listening · click to finish"
                      : voicePhase === "finishing"
                        ? "Transcribing…"
                        : context.number
                          ? `Using checkpoint ${String(context.number).padStart(2, "0")}`
                          : ""}
                </span>
              </div>
              <div className="send-actions">
                {isBusy ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      cancelled.current = true;
                      void call("cancel_request");
                    }}
                  >
                    Stop
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="button capture-button"
                      title="Capture screen and repository changes · Ctrl+Shift+Enter"
                      disabled={voicePhase !== "idle"}
                      onClick={() => void request(true)}
                    >
                      <ScanLine size={16} />
                      <span>Fresh check</span>
                    </button>
                    <button
                      type="submit"
                      className="send-button"
                      aria-label="Send message"
                      title="Send · Enter"
                      disabled={!draft.trim() || voicePhase !== "idle"}
                    >
                      <ArrowUp size={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </form>
          <div className="composer-caption">
            <span>Save your files before a fresh check.</span>
            <span>
              <kbd>↵</kbd> send <span className="caption-gap">·</span>{" "}
              <kbd>Shift ↵</kbd> new line
            </span>
          </div>
        </div>
        <footer className="statusbar">
          <span className="status-left">
            <span
              className={`status-dot ${voicePhase !== "idle" ? "listening" : ""}`}
            />
            {voicePhase !== "idle"
              ? "Microphone active"
              : isBusy
                ? "Working"
                : "Ready"}
            {context.repository?.branch && (
              <span className="branch">
                <GitBranch size={12} />
                {context.repository.branch}
              </span>
            )}
          </span>
          <span
            title={`${usage.requests} completed requests · ${usage.inputTokens} input / ${usage.outputTokens} output tokens`}
          >
            {usage.requests > 0 &&
              `${tokens(usage.inputTokens + usage.outputTokens)} tokens · `}
            {settings.provider === "ollama" ? "Local model" : "Paid API"}
            <span className="caption-gap">·</span>v0.1.0
          </span>
        </footer>
      </section>
      {showMilestones && active && (
        <Modal
          title="Session progress"
          onClose={() => setShowMilestones(false)}
        >
          <div className="milestones-body">
            {goal && <p className="milestone-goal">{goal}</p>}
            <ProgressVisual
              items={milestones}
              history={progressHistory}
              expanded
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={automaticProgress}
                disabled={isBusy}
                onChange={(e) => setAutomaticProgress(e.target.checked)}
              />
              Automatic progress on Fresh check
            </label>
            <p className="field-note">
              AI assessments use checkpoint evidence. Manual status changes stay
              protected until you release them.
            </p>
            {progressNotice && (
              <p role="status" className="field-note">
                {progressNotice}
              </p>
            )}
            <Milestones
              allowAdd={false}
              items={milestones}
              onChange={setMilestones}
              disabled={isBusy}
            />
            {progressHistory.some((p) => !p.undone) && (
              <button
                type="button"
                className="button secondary"
                disabled={isBusy}
                onClick={async () => {
                  try {
                    applyProgress(await call<ProgressState>("undo_progress"));
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Undo last assessment
              </button>
            )}

            <div className="modal-footer">
              <button
                type="button"
                className="button primary"
                onClick={() => setShowMilestones(false)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showSettings && active && (
        <SettingsDialog
          initial={settings}
          requireVision={includeScreen}
          onClose={() => setShowSettings(false)}
          onSaved={(value) => {
            setSettings(value);
            onSettings(value);
            setShowSettings(false);
          }}
        />
      )}
      {showContext && active && (
        <ContextDialog
          context={context}
          onClose={() => setShowContext(false)}
        />
      )}
      {showReferences && active && (
        <ReferencesDialog
          sessionKey={sessionKey}
          references={references}
          onChange={setReferences}
          onClose={() => setShowReferences(false)}
        />
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  initialFocusRef,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  initialFocusRef?: { current: HTMLElement | null };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    initialFocusRef?.current?.focus();
    return () => dialog?.close();
  }, [initialFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ReferencesDialog({
  sessionKey,
  references,
  onChange,
  onClose,
}: {
  sessionKey: string;
  references: Reference[];
  onChange: (items: Reference[]) => void;
  onClose: () => void;
}) {
  const call = useCallback(
    <T,>(command: string, args?: Record<string, unknown>) =>
      invokeNative<T>(command, { ...args, sessionId: sessionKey }),
    [sessionKey],
  );
  const [kind, setKind] = useState<Reference["kind"]>("link");
  const [source, setSource] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(
    command: string,
    args: Record<string, unknown>,
    clear = false,
  ) {
    setPending(true);
    setError("");
    try {
      const items = await call<Reference[]>(command, args);
      onChange(items);
      if (mounted.current && clear) setSource("");
    } catch (e) {
      if (mounted.current) setError(errorText(e));
      try {
        onChange(await call<Reference[]>("list_references"));
      } catch {
        /* Keep the visible snapshot on a bridge failure. */
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Modal
      title="References"
      wide
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className="references-body" aria-busy={pending}>
        <p className="field-note">
          Included text is shared with the coach on your next message. Reference
          locations and pasted text are saved with the session; extracted file
          and web content stays in memory.
        </p>
        <form
          className="reference-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run("add_reference", { kind, source }, true);
          }}
        >
          <div className="field">
            <label htmlFor="reference-kind">Reference type</label>
            <select
              id="reference-kind"
              value={kind}
              disabled={pending}
              onChange={(e) => {
                setKind(e.target.value as Reference["kind"]);
                setSource("");
              }}
            >
              <option value="link">Web link</option>
              <option value="file">File</option>
              <option value="folder">Folder</option>
              <option value="text">Pasted text</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="reference-source">
              {kind === "link"
                ? "HTTPS link"
                : kind === "text"
                  ? "Reference text"
                  : `${kind === "folder" ? "Folder" : "File"} path`}
            </label>
            {kind === "text" ? (
              <textarea
                id="reference-source"
                rows={5}
                maxLength={100000}
                value={source}
                disabled={pending}
                onChange={(e) => setSource(e.target.value)}
              />
            ) : (
              <input
                id="reference-source"
                type={kind === "link" ? "url" : "text"}
                maxLength={4096}
                value={source}
                disabled={pending}
                onChange={(e) => setSource(e.target.value)}
                placeholder={kind === "link" ? "https://…" : "C:\\…"}
              />
            )}
          </div>
          <div className="reference-actions">
            {(kind === "file" || kind === "folder") && (
              <button
                type="button"
                className="button secondary"
                disabled={pending || references.length >= 8 || !native}
                onClick={() =>
                  void run("pick_reference", { folder: kind === "folder" })
                }
              >
                <FolderOpen size={15} />
                Browse…
              </button>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={
                pending || !source.trim() || references.length >= 8 || !native
              }
            >
              {pending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Plus size={15} />
              )}
              Add reference
            </button>
          </div>
        </form>
        <p className="field-note">
          PDF, UTF-8 text/code, and HTML. Up to 8 references, 8 MiB per file,
          and 10,000 extracted characters per reference. Login-only pages and
          scanned PDFs may need pasted text.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!native && (
          <p className="notice">Open the desktop app to attach references.</p>
        )}
        <div className="reference-list">
          {references.map((item) => (
            <article className="reference-item" key={item.id}>
              <div className="reference-heading">
                <label className="reference-include">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={pending}
                    aria-label={`Include ${item.label}`}
                    onChange={() =>
                      void run("update_reference", {
                        id: item.id,
                        action: "toggle",
                      })
                    }
                  />
                  <span title={item.kind === "text" ? undefined : item.source}>
                    {item.label}
                  </span>
                </label>
                <button
                  className="icon-button"
                  disabled={pending}
                  title="Refresh reference"
                  aria-label={`Refresh ${item.label}`}
                  onClick={() =>
                    void run("update_reference", {
                      id: item.id,
                      action: "refresh",
                    })
                  }
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  className="icon-button"
                  disabled={pending}
                  title="Remove reference"
                  aria-label={`Remove ${item.label}`}
                  onClick={() =>
                    void run("update_reference", {
                      id: item.id,
                      action: "remove",
                    })
                  }
                >
                  <X size={15} />
                </button>
              </div>
              <p className={`field-note ${item.text ? "" : "reference-error"}`}>
                {item.text
                  ? `${item.text.length.toLocaleString()} characters · ${new Date(item.loadedAt).toLocaleTimeString()} · `
                  : ""}
                {item.note}
              </p>
              {item.text && (
                <details>
                  <summary>Inspect extracted text</summary>
                  <pre>{item.text}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
        <p className="field-note">
          Uncheck or remove a reference to exclude it from future requests.
          Earlier conversation may still mention previously shared content.
        </p>
        <div role="status" className="field-note">
          {pending
            ? "Reading reference…"
            : `${references.length} of 8 references attached`}
        </div>
      </div>
    </Modal>
  );
}

function SettingsDialog({
  initial,
  requireVision,
  onClose,
  onSaved,
}: {
  initial: Settings;
  requireVision: boolean;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}) {
  const [value, setValue] = useState(initial);
  const [section, setSection] = useState("appearance");
  const sections = [
    ["appearance", "Appearance"],
    ["ai", "AI model"],
    ["voice", "Voice"],
    ["key", "API key"],
  ];
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String((value.textSize ?? 100) / 100),
    );
    document.documentElement.style.fontSize = `${(16 * (value.textSize ?? 100)) / 100}px`;
    return () => {
      document.documentElement.style.setProperty(
        "--text-scale",
        String((initial.textSize ?? 100) / 100),
      );
      document.documentElement.style.fontSize = `${(16 * (initial.textSize ?? 100)) / 100}px`;
    };
  }, [value.textSize, initial.textSize]);
  const [previewing, setPreviewing] = useState(false);
  const previewGeneration = useRef(0);
  useEffect(
    () => () => {
      previewGeneration.current++;
      void call("stop_speaking");
    },
    [],
  );
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelChoice, setModelChoice] = useState(
    initial.model || "__recommended__",
  );
  const eligible = compatibleModels(models, requireVision);
  const recommended = eligible[0];
  const selection =
    modelChoice === "__custom__"
      ? modelChoice
      : modelChoice === recommended?.id
        ? "__recommended__"
        : eligible.some((m) => m.id === modelChoice)
          ? modelChoice
          : "__recommended__";
  const selectedModel =
    selection === "__recommended__"
      ? recommended?.id || ""
      : selection === "__custom__"
        ? value.model
        : selection;
  const manualModel = selection === "__custom__";
  const efforts = reasoningEfforts(value.provider, selectedModel);
  const effort = compatibleEffort(
    value.provider,
    selectedModel,
    value.reasoningEffort,
  );
  const incompatible = knownIncompatible(
    models.find((m) => m.id === selectedModel),
    requireVision,
  );
  const modelRequest = useRef(0);
  const loadModels = useCallback(
    async (
      provider: Settings["provider"],
      localUrl: string,
      apiKey: string,
      removeKey: boolean,
    ) => {
      const request = ++modelRequest.current;
      setModelsLoading(true);
      setModelsError("");
      try {
        const result = await call<Model[]>("list_models", {
          provider,
          localUrl,
          apiKey: apiKey || null,
          clearKey: removeKey,
        });
        if (request === modelRequest.current) setModels(result);
      } catch (e) {
        if (request === modelRequest.current) {
          setModels([]);
          setModelsError(errorText(e));
        }
      } finally {
        if (request === modelRequest.current) setModelsLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    const generation = modelRequest;
    const timer = window.setTimeout(
      () => {
        void loadModels(value.provider, value.localUrl, key, clearKey);
      },
      key.trim() ? 1000 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      generation.current++;
    };
  }, [value.provider, value.localUrl, key, clearKey, loadModels]);
  function invalidateModels() {
    modelRequest.current++;
    setModels([]);
    setModelsLoading(true);
    setModelsError("");
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = await call<Settings>("save_settings", {
        settings: { ...value, model: selectedModel, reasoningEffort: effort },
        apiKey: key || null,
        clearKey,
      });
      setKey("");
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Settings" onClose={onClose}>
      <form className="settings-form" onSubmit={(e) => void save(e)}>
        <div
          className="settings-nav"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const index = sections.findIndex(([id]) => id === section);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? sections.length - 1
                  : (index +
                      (e.key === "ArrowRight" ? 1 : -1) +
                      sections.length) %
                    sections.length;
            setSection(sections[next][0]);
            document
              .getElementById(`settings-tab-${sections[next][0]}`)
              ?.focus();
          }}
        >
          {sections.map(([id, label]) => (
            <button
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              key={id}
              aria-selected={section === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={section === id ? 0 : -1}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section
          className="settings-section"
          role="tabpanel"
          id="settings-panel-appearance"
          aria-labelledby="settings-tab-appearance"
          hidden={section !== "appearance"}
        >
          <div className="field">
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              value={value.theme}
              onChange={(e) =>
                setValue({
                  ...value,
                  theme: e.target.value as Settings["theme"],
                })
              }
            >
              <option value="system">Follow system</option>
              <option value="light">VS Code Light Modern</option>
              <option value="dark">VS Code Dark Modern</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="text-size">Text size</label>
            <div className="text-size-control">
              <button
                type="button"
                className="button secondary"
                aria-label="Decrease text size"
                disabled={value.textSize <= 85}
                onClick={() =>
                  setValue({
                    ...value,
                    textSize: Math.max(85, value.textSize - 5),
                  })
                }
              >
                −
              </button>
              <input
                id="text-size"
                type="range"
                min={85}
                max={150}
                step={5}
                value={value.textSize ?? 100}
                onChange={(e) =>
                  setValue({ ...value, textSize: Number(e.target.value) })
                }
              />
              <button
                type="button"
                className="button secondary"
                aria-label="Increase text size"
                disabled={value.textSize >= 150}
                onClick={() =>
                  setValue({
                    ...value,
                    textSize: Math.min(150, value.textSize + 5),
                  })
                }
              >
                +
              </button>
              <output htmlFor="text-size">{value.textSize ?? 100}%</output>
            </div>
            <p className="field-note">
              Applies throughout CoCo, including chat, tabs, and controls.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => setValue({ ...value, textSize: 100 })}
            >
              Reset to 100%
            </button>
          </div>
        </section>
        <section
          className="settings-section"
          role="tabpanel"
          id="settings-panel-ai"
          aria-labelledby="settings-tab-ai"
          hidden={section !== "ai"}
        >
          <div className="field">
            <label htmlFor="provider">AI provider</label>
            <select
              id="provider"
              value={value.provider}
              onChange={(e) => {
                const next = {
                  ...value,
                  provider: e.target.value as Settings["provider"],
                  model: "",
                };
                setValue(next);
                setModelChoice("__recommended__");
                setModels([]);
                invalidateModels();
              }}
            >
              <option value="ollama">Ollama · local</option>
              <option value="openai">OpenAI · paid API</option>
            </select>
          </div>
          {value.provider === "ollama" ? (
            <>
              <div className="field">
                <label htmlFor="endpoint">Server URL</label>
                <input
                  id="endpoint"
                  value={value.localUrl}
                  onChange={(e) => {
                    invalidateModels();
                    setValue({ ...value, localUrl: e.target.value });
                  }}
                  required={section === "ai"}
                />
              </div>
              <p className="field-note">
                Use a running local Ollama server and an installed vision model.
                No models are downloaded automatically.
              </p>
            </>
          ) : null}
          <div className="field">
            <label htmlFor="model">Model</label>
            <div className="model-picker">
              <select
                id="model"
                value={selection}
                onChange={(e) => {
                  const manual = e.target.value === "__custom__";
                  if (manual)
                    setValue({ ...value, model: selectedModel || value.model });
                  setModelChoice(e.target.value);
                }}
                required={section === "ai"}
                disabled={saving}
              >
                <option value="__recommended__" disabled={!recommended}>
                  {modelsLoading
                    ? "Loading models…"
                    : recommended
                      ? `Recommended — ${recommended.id}`
                      : "No compatible models available"}
                </option>
                {eligible
                  .filter((model) => model.id !== recommended?.id)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                <option value="__custom__">Enter a model ID manually…</option>
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh models"
                title="Refresh models"
                disabled={modelsLoading || saving}
                onClick={() =>
                  void loadModels(value.provider, value.localUrl, key, clearKey)
                }
              >
                <RefreshCw
                  size={17}
                  className={modelsLoading ? "spin" : undefined}
                />
              </button>
            </div>
            {manualModel && (
              <>
                <label htmlFor="custom-model">Model ID</label>
                <input
                  id="custom-model"
                  value={value.model}
                  onChange={(e) =>
                    setValue({ ...value, model: e.target.value })
                  }
                  maxLength={150}
                  required={section === "ai"}
                />
              </>
            )}
            <span className="field-note" role="status">
              {modelsLoading
                ? "Loading available models…"
                : modelsError ||
                  (eligible.length
                    ? ""
                    : `No verified ${requireVision ? "text-and-image" : "text"} models available. Refresh or enter a model ID manually.`)}
            </span>
            <p className="field-note">
              {incompatible
                ? "This model does not support the enabled coaching inputs."
                : manualModel
                  ? "Manual model capabilities are unverified. Screen coaching requires image input."
                  : selection === "__recommended__" && recommended
                    ? recommended.reason
                    : requireVision
                      ? "Showing models verified for text and image input."
                      : "Showing models verified for text coaching."}
            </p>
          </div>
          <div className="field">
            <label htmlFor="reasoning-effort">Reasoning effort</label>
            <select
              id="reasoning-effort"
              value={effort}
              disabled={!efforts.length}
              onChange={(e) =>
                setValue({ ...value, reasoningEffort: e.target.value })
              }
              aria-describedby="reasoning-note"
            >
              <option value="auto">Auto (model default)</option>
              {efforts.map((level) => (
                <option key={level} value={level}>
                  {(
                    {
                      none: "None",
                      minimal: "Minimal",
                      low: "Low",
                      medium: "Medium",
                      high: "High",
                      xhigh: "Very high",
                      max: "Maximum",
                    } as Record<string, string>
                  )[level] ?? level}
                </option>
              ))}
            </select>
            <p className="field-note" id="reasoning-note">
              {efforts.length
                ? "Higher effort can take longer and use more tokens. Auto uses the model’s default."
                : value.provider === "ollama"
                  ? "Ollama uses its model default; effort control is not configured."
                  : "Effort control is not verified for this model; Auto uses its default."}
            </p>
          </div>
        </section>
        <section
          className="settings-section"
          role="tabpanel"
          id="settings-panel-voice"
          aria-labelledby="settings-tab-voice"
          hidden={section !== "voice"}
        >
          <div className="section-row">
            <span>Read responses aloud</span>
            <span id="speech-toggle">
              <Toggle
                checked={value.speakAnswers}
                onChange={(speakAnswers) =>
                  setValue({ ...value, speakAnswers })
                }
                label="Read responses aloud"
              />
            </span>
          </div>
          <p className="field-note">
            Automatic speech is optional. The speaker button can read a reply on
            demand.
          </p>
          <div className="field">
            <label htmlFor="speech-provider">Speech provider</label>
            <select
              id="speech-provider"
              value={value.speech.provider}
              onChange={(e) => {
                previewGeneration.current++;
                setPreviewing(false);
                void call("stop_speaking");
                setValue({
                  ...value,
                  speech: {
                    ...value.speech,
                    provider: e.target.value as "windows" | "openai",
                  },
                });
              }}
            >
              <option value="windows">Windows · local, no API charge</option>
              <option value="openai">OpenAI · natural voice, paid API</option>
            </select>
          </div>
          {value.speech.provider === "openai" && (
            <>
              <div className="field">
                <label htmlFor="speech-voice">Speaking voice</label>
                <select
                  id="speech-voice"
                  value={value.speech.voice}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      speech: { ...value.speech, voice: e.target.value },
                    })
                  }
                >
                  {[
                    "marin",
                    "cedar",
                    "alloy",
                    "ash",
                    "ballad",
                    "coral",
                    "echo",
                    "fable",
                    "nova",
                    "onyx",
                    "sage",
                    "shimmer",
                    "verse",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="speech-speed">Speaking speed</label>
                <select
                  id="speech-speed"
                  value={value.speech.speed}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      speech: {
                        ...value.speech,
                        speed: Number(e.target.value),
                      },
                    })
                  }
                >
                  <option value={0.75}>Slower · 0.75×</option>
                  <option value={1}>Normal · 1×</option>
                  <option value={1.25}>Faster · 1.25×</option>
                </select>
              </div>
              <p className="field-note">
                Uses gpt-4o-mini-tts and your existing OpenAI key. Preview and
                spoken replies incur additional API charges and send the spoken
                text to OpenAI. This is an AI-generated voice.
              </p>
            </>
          )}
          <div className="section-row">
            <button
              type="button"
              className="button secondary"
              disabled={
                previewing ||
                !native ||
                (value.speech.provider === "openai" &&
                  !key.trim() &&
                  (!initial.hasApiKey || clearKey))
              }
              onClick={async () => {
                const generation = ++previewGeneration.current;
                setPreviewing(true);
                setError("");
                try {
                  await call("speak", {
                    text: "Let's take this one step at a time. Show me where you're stuck, and we'll work through it together.",
                    speech: value.speech,
                    apiKey: key || null,
                  });
                } catch (e) {
                  if (generation === previewGeneration.current)
                    setError(errorText(e));
                } finally {
                  if (generation === previewGeneration.current)
                    setPreviewing(false);
                }
              }}
            >
              {previewing ? "Previewing…" : "Preview voice"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                previewGeneration.current++;
                setPreviewing(false);
                void call("stop_speaking");
              }}
            >
              Stop preview
            </button>
          </div>
          <p className="field-note">
            Microphone input stays on Windows speech recognition. Review the
            transcript before sending.
          </p>
        </section>
        <section
          className="settings-section"
          role="tabpanel"
          id="settings-panel-key"
          aria-labelledby="settings-tab-key"
          hidden={section !== "key"}
        >
          <div className="field">
            <label htmlFor="api-key">
              API key{" "}
              {initial.hasApiKey && !clearKey && (
                <span className="saved-key">Saved securely</span>
              )}
            </label>
            <input
              id="api-key"
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                initial.hasApiKey && !clearKey
                  ? "Leave blank to keep saved key"
                  : "sk-…"
              }
              onChange={(e) => {
                invalidateModels();
                setKey(e.target.value);
              }}
            />
          </div>
          {initial.hasApiKey && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(e) => {
                  invalidateModels();
                  setClearKey(e.target.checked);
                }}
              />
              Remove saved API key
            </label>
          )}
          <p className="field-note">
            One key is shared by OpenAI coaching and speech. Selected context or
            spoken text is sent when you use those features. API usage is billed
            separately. The key stays in Windows Credential Manager.
          </p>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              saving ||
              (section === "ai" && (modelsLoading || !selectedModel.trim())) ||
              incompatible ||
              (value.speech.provider === "openai" &&
                !key.trim() &&
                (!initial.hasApiKey || clearKey))
            }
          >
            {saving && <LoaderCircle size={15} className="spin" />}Save settings
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContextDialog({
  context,
  onClose,
}: {
  context: Context;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"files" | "screen">("files");
  return (
    <Modal
      title={`Checkpoint ${String(context.number).padStart(2, "0")}`}
      onClose={onClose}
      wide
    >
      <div className="context-dialog">
        <div className="context-tabs">
          <button
            className={tab === "files" ? "selected" : ""}
            onClick={() => setTab("files")}
          >
            Repository
          </button>
          <button
            className={tab === "screen" ? "selected" : ""}
            onClick={() => setTab("screen")}
          >
            Screen
          </button>
        </div>
        {tab === "screen" ? (
          context.screen ? (
            <>
              <img
                className="capture-preview"
                src={context.screen.dataUrl}
                alt="Screen captured for this checkpoint"
              />
              <p className="field-note">
                {context.screen.width} × {context.screen.height} · captured{" "}
                {new Date(context.capturedAt!).toLocaleTimeString()} · kept in
                memory
              </p>
            </>
          ) : (
            <p className="empty-detail">No screen captured.</p>
          )
        ) : context.repository ? (
          <>
            <p className="context-summary">
              {context.repository.fileCount} eligible text files ·{" "}
              {context.repository.files.length} excerpts selected
              {context.repository.baseline
                ? " · new baseline"
                : ` · ${context.repository.changes.length} changed`}
            </p>
            {(context.repository.limited || context.repository.skipped > 0) && (
              <p className="notice">
                Context is partial. {context.repository.skipped} oversized,
                unreadable, or binary files skipped
                {context.repository.limited ? "; scan limit reached" : ""}.
              </p>
            )}
            <div className="file-list">
              {context.repository.changes.length > 0 && (
                <div className="change-list">
                  {context.repository.changes.map((change) => (
                    <details key={change.path}>
                      <summary>
                        <span className={`change-kind ${change.kind}`}>
                          {change.kind[0].toUpperCase()}
                        </span>
                        <code>{change.path}</code>
                      </summary>
                      {change.patch && <pre>{change.patch}</pre>}
                    </details>
                  ))}
                </div>
              )}
              {context.repository.files.map((file) => (
                <details key={file.path}>
                  <summary>
                    <Code2 size={14} />
                    <code>{file.path}</code>
                    {file.truncated && <span className="muted">excerpt</span>}
                  </summary>
                  <pre>{file.text}</pre>
                </details>
              ))}
            </div>
            <p className="field-note">
              Saved files only. Common secrets are filtered; inspect sensitive
              code before using a cloud provider.
            </p>
          </>
        ) : (
          <p className="empty-detail">No repository included.</p>
        )}
      </div>
    </Modal>
  );
}
