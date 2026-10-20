import { describe, expect, it } from "vitest";
import {
  compatibleModels,
  knownIncompatible,
  reasoningEfforts,
  compatibleEffort,
} from "./models";
import type { Model } from "./types";
const model = (
  id: string,
  completion: boolean | null,
  vision: boolean | null,
  rank = 0,
  size: number | null = null,
): Model => ({ id, completion, vision, rank, size, reason: "Fixture" });
describe("coaching model selection", () => {
  it("limits effort choices to verified model families and resets incompatible choices", () => {
    expect(reasoningEfforts("openai", "gpt-6.1-sol")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(reasoningEfforts("openai", "gpt-5-mini-2025-08-07")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    for (const [provider, id] of [
      ["ollama", "gpt-6.1-sol"],
      ["openai", "gpt-4o"],
      ["openai", "gpt-6.1-sol-custom"],
    ]) {
      expect(reasoningEfforts(provider, id)).toEqual([]);
      expect(compatibleEffort(provider, id, "high")).toBe("auto");
    }
    expect(compatibleEffort("openai", "gpt-5-mini", "max")).toBe("auto");
    expect(compatibleEffort("openai", "gpt-6.1-sol", "high")).toBe("high");
  });
  it("filters unknown, embedding, and non-vision models for screen coaching", () => {
    const models = [
      model("text", true, false),
      model("image", true, true),
      model("unknown", null, null),
      model("embedding", false, false),
    ];
    expect(compatibleModels(models, true).map((m) => m.id)).toEqual(["image"]);
    expect(compatibleModels(models, false).map((m) => m.id)).toEqual([
      "image",
      "text",
    ]);
    expect(knownIncompatible(models[0], true)).toBe(true);
    expect(knownIncompatible(models[2], true)).toBe(false);
  });
  it("ranks only available compatible models and uses smaller local files as a starting point", () => {
    expect(
      compatibleModels(
        [model("premium", true, true, 3), model("balanced", true, true, 0)],
        true,
      )[0].id,
    ).toBe("balanced");
    expect(
      compatibleModels(
        [model("large", true, true, 0, 80), model("small", true, true, 0, 8)],
        true,
      )[0].id,
    ).toBe("small");
    expect(compatibleModels([], true)).toEqual([]);
  });
});
