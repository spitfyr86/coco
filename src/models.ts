import type { Model } from "./types";
import policy from "../src-tauri/model-policy.json";

export function reasoningEfforts(provider: string, model: string): string[] {
  if (provider !== "openai") return [];
  return (
    policy.find(
      (p) =>
        model.trim() === p.id ||
        (model.trim().startsWith(p.id) &&
          /^-\d{4}-\d{2}-\d{2}$/.test(model.trim().slice(p.id.length))),
    )?.reasoningEfforts ?? []
  );
}

export function compatibleEffort(
  provider: string,
  model: string,
  effort: string,
): string {
  return reasoningEfforts(provider, model).includes(effort) ? effort : "auto";
}

export function compatibleModels(
  models: Model[],
  requireVision: boolean,
): Model[] {
  return models
    .filter(
      (m) => m.completion === true && (!requireVision || m.vision === true),
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.size ?? Number.MAX_SAFE_INTEGER) -
          (b.size ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
}

export function knownIncompatible(
  model: Model | undefined,
  requireVision: boolean,
): boolean {
  return (
    !!model &&
    (model.completion === false || (requireVision && model.vision === false))
  );
}
