import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { defaults, emptyContext } from "./types";

export const native = isTauri();
export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (native) return invoke<T>(command, args);
  // A browser preview never captures the desktop, reads a repository, or contacts a model.
  if (command === "load_settings") return defaults as T;
  if (
    command === "list_sources" ||
    command === "shortcut_warnings" ||
    command === "list_references"
  )
    return [] as T;
  if (command === "voice_status") return { recognizers: [], voices: [] } as T;
  if (command === "reset_session") return emptyContext as T;
  if (
    command === "stop_speaking" ||
    command === "stop_voice" ||
    command === "cancel_request"
  )
    return undefined as T;
  throw new Error("Open the CoCo desktop app to use native features.");
}
export async function subscribe<T>(
  name: string,
  callback: (value: T) => void,
): Promise<() => void> {
  return native
    ? listen<T>(name, (event) => callback(event.payload))
    : () => {};
}
