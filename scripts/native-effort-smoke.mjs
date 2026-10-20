// Native Settings integration; discovery is intercepted before execution.
// No external model calls, key changes, or inference.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9237",
);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /1420|tauri.localhost/.test(p.url()));
assert.ok(page);
const invoke = (command, args) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const initial = await invoke("load_settings");
let session;
let breakpointId;
let interceptionError;
try {
  await invoke("save_settings", {
    settings: {
      ...initial,
      provider: "ollama",
      model: "",
      reasoningEffort: "auto",
      theme: "system",
    },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  session = await page.context().newCDPSession(page);
  await session.send("Debugger.enable");
  const reference = await session.send("Runtime.evaluate", {
    expression: "window.__TAURI_INTERNALS__.invoke",
  });
  session.on("Debugger.paused", async (event) => {
    try {
      const frame = event.callFrames[0];
      await session.send("Debugger.setVariableValue", {
        scopeNumber: frame.scopeChain.findIndex(
          (scope) => scope.type === "local",
        ),
        variableName: "cmd",
        newValue: { value: "__coco_effort_test_no_network__" },
        callFrameId: frame.callFrameId,
      });
    } catch (error) {
      interceptionError = error;
    } finally {
      await session.send("Debugger.resume").catch(() => {});
    }
  });
  ({ breakpointId } = await session.send(
    "Debugger.setBreakpointOnFunctionCall",
    { objectId: reference.result.objectId, condition: "cmd === 'list_models'" },
  ));
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole("button", { name: "Settings", exact: false }).click();
    await page.getByLabel("AI provider").selectOption("ollama");
    const effort = page.getByLabel("Reasoning effort", { exact: true });
    await expect(effort).toBeDisabled();
    await expect(effort).toHaveValue("auto");
    await page.getByLabel("AI provider").selectOption("openai");
    await expect(
      page.getByRole("button", { name: "Refresh models" }),
    ).toBeEnabled();
    await page.getByLabel("Model", { exact: true }).selectOption("__custom__");
    await page.getByLabel("Model ID", { exact: true }).fill("gpt-6.1-sol");
    await expect(effort).toBeEnabled();
    assert.deepEqual(
      await effort
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value)),
      ["auto", "low", "medium", "high", "xhigh", "max"],
    );
    await effort.selectOption("high");
    await effort.scrollIntoViewIfNeeded();
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/native-effort-${theme}.png` });
    await page.getByLabel("Model ID", { exact: true }).fill("gpt-4o");
    await expect(effort).toBeDisabled();
    await expect(effort).toHaveValue("auto");
    await page.getByLabel("Model ID", { exact: true }).fill("gpt-5-mini");
    assert.deepEqual(
      await effort
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value)),
      ["auto", "minimal", "low", "medium", "high"],
    );
    await effort.selectOption("low");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await invoke("load_settings");
    assert.equal(saved.reasoningEffort, "low");
    assert.equal(saved.model, "gpt-5-mini");
    await assert.rejects(
      invoke("save_settings", {
        settings: { ...saved, model: "gpt-4o", reasoningEffort: "high" },
        apiKey: null,
        clearKey: false,
      }),
    );
    // Restore the starting provider through the UI for the next theme, without reloading the debugger target.
    await page.getByRole("button", { name: "Settings", exact: false }).click();
    await page.getByLabel("AI provider").selectOption("ollama");
    await expect(effort).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  assert.equal(interceptionError, undefined);
  console.log(
    "Passed: both-theme effort controls, model compatibility, persistence, native rejection, and accessibility; no external requests.",
  );
} finally {
  if (breakpointId)
    await session
      .send("Debugger.removeBreakpoint", { breakpointId })
      .catch(() => {});
  if (session) {
    await session.send("Debugger.disable").catch(() => {});
    await session.detach().catch(() => {});
  }
  await invoke("save_settings", {
    settings: initial,
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  await browser.close();
}
