export interface Settings {
  provider: "ollama" | "openai";
  model: string;
  reasoningEffort: string;
  localUrl: string;
  theme: "system" | "light" | "dark";
  textSize: number;
  speakAnswers: boolean;
  speech: { provider: "windows" | "openai"; voice: string; speed: number };
  hasApiKey: boolean;
}
export interface Source {
  id: string;
  label: string;
  kind: "monitor" | "window";
}
export interface Reference {
  id: number;
  kind: "file" | "folder" | "link" | "text";
  source: string;
  label: string;
  text: string;
  note: string;
  enabled: boolean;
  loadedAt: number;
}
export interface Model {
  id: string;
  completion: boolean | null;
  vision: boolean | null;
  rank: number;
  size: number | null;
  reason: string;
}
export interface Change {
  path: string;
  kind: "added" | "modified" | "deleted";
  patch: string;
}
export interface ContextFile {
  path: string;
  text: string;
  truncated: boolean;
}
export interface Repository {
  root: string;
  branch: string | null;
  revision: string | null;
  fileCount: number;
  skipped: number;
  limited: boolean;
  tree: string[];
  changes: Change[];
  files: ContextFile[];
  baseline: boolean;
}
export interface Context {
  repository: Repository | null;
  screen: {
    dataUrl: string;
    source: string;
    width: number;
    height: number;
  } | null;
  capturedAt: number | null;
  number: number;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}
export interface Answer {
  text: string;
  progress?: ProgressState;
  usage: Usage;
  messages?: Message[];
  saveError?: string | null;
}
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  open: boolean;
}
export interface SavedSession {
  version: number;
  id: string;
  title: string;
  customTitle: boolean;
  goal: string;
  draft: string;
  root: string | null;
  sourceId: string;
  includeScreen: boolean;
  includeRepo: boolean;
  messages: Message[];
  usage: Usage;
  references: Pick<Reference, "id" | "kind" | "source" | "label" | "enabled">[];
  createdAt: number;
  updatedAt: number;
  formRevision: number;
  lastCheckpoint: number;
  progressHistory: ProgressCheckpoint[];
  progressNotice: string;
  milestones: Milestone[];
  automaticProgress: boolean;
  progressEpoch: number;
  contextWidth: number;
  contextCollapsed: boolean;
}
export interface Milestone {
  id: string;
  title: string;
  done: boolean;
  status: ProgressStatus;
  manual: boolean;
  reason: string;
  evidence: string;
  checkpoint: number | null;
}
export type ProgressStatus =
  "not_started" | "in_progress" | "needs_verification" | "complete";
export interface ProgressCheckpoint {
  checkpoint: number;
  time: number;
  before: Milestone[];
  after: Milestone[];
  undone: boolean;
}
export interface ProgressState {
  milestones: Milestone[];
  history: ProgressCheckpoint[];
  epoch: number;
  automatic: boolean;
  notice: string;
}
export interface SessionView {
  document: SavedSession;
  context: Context;
  references: Reference[];
}
export interface WorkspaceState {
  sessions: SessionSummary[];
  openIds: string[];
  activeId: string;
  warning: string;
}
export interface SessionForm {
  milestones: Milestone[];
  automaticProgress: boolean;
  progressEpoch: number;
  contextWidth: number;
  contextCollapsed: boolean;
  goal: string;
  draft: string;
  sourceId: string;
  includeScreen: boolean;
  includeRepo: boolean;
  revision: number;
  pending: boolean;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  checkpoint: number;
  time: number;
}
export interface VoiceEvent {
  id: number;
  kind: "ready" | "partial" | "result" | "error";
  text: string;
}
export const defaults: Settings = {
  provider: "ollama",
  model: "",
  reasoningEffort: "auto",
  localUrl: "http://127.0.0.1:11434",
  theme: "system",
  textSize: 100,
  speakAnswers: true,
  speech: { provider: "windows", voice: "marin", speed: 1 },
  hasApiKey: false,
};
export const emptyContext: Context = {
  repository: null,
  screen: null,
  capturedAt: null,
  number: 0,
};
