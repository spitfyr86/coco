// Observe real UI IPC calls through CDP. Rewrite discovery/save commands to an
// unregistered name before they execute, so no test key is sent or persisted.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9237",
);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /1420|tauri.localhost/.test(p.url()));
assert.ok(page);
const session = await page.context().newCDPSession(page);
let calls = 0;
let saves = 0;
let interceptionError;
let breakpointId;
await session.send("Debugger.enable");
const reference = await session.send("Runtime.evaluate", {
  expression: "window.__TAURI_INTERNALS__.invoke",
});
session.on("Debugger.paused", async (event) => {
  try {
    const frame = event.callFrames[0];
    const current = await session.send("Debugger.evaluateOnCallFrame", {
      callFrameId: frame.callFrameId,
      expression: "cmd",
      returnByValue: true,
    });
    if (current.result.value === "list_models") calls++;
    if (current.result.value === "save_settings") saves++;
    await session.send("Debugger.setVariableValue", {
      scopeNumber: frame.scopeChain.findIndex(
        (scope) => scope.type === "local",
      ),
      variableName: "cmd",
      newValue: { value: "__coco_discovery_test_no_network__" },
      callFrameId: frame.callFrameId,
    });
  } catch (error) {
    interceptionError = error;
  } finally {
    await session.send("Debugger.resume").catch(() => {});
  }
});
try {
  ({ breakpointId } = await session.send(
    "Debugger.setBreakpointOnFunctionCall",
    {
      objectId: reference.result.objectId,
      condition: "cmd === 'list_models' || cmd === 'save_settings'",
    },
  ));
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "AI model", exact: true }).click();
  await page.getByLabel("AI provider").selectOption("openai");
  await expect(
    page.getByRole("button", { name: "Refresh models" }),
  ).toBeEnabled();
  await expect.poll(() => calls).toBeGreaterThan(0);
  const baseline = calls;
  await page.getByRole("tab", { name: "API key", exact: true }).click();
  await page.locator("#api-key").fill("test-only-key");
  await page.waitForTimeout(300);
  assert.equal(calls, baseline, "Discovery ran before the debounce elapsed");
  await page.locator("#api-key").fill("test-only-key-edited");
  await page.waitForTimeout(300);
  assert.equal(calls, baseline, "Typing did not cancel the pending discovery");
  await expect.poll(() => calls).toBe(baseline + 1);
  await page.waitForTimeout(1200);
  assert.equal(
    calls,
    baseline + 1,
    "Key editing caused duplicate discovery calls",
  );
  assert.equal(saves, 0, "Key entry attempted to save settings");
  assert.equal(interceptionError, undefined);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await writeFile(
    "artifacts/native-key-loading-smoke.json",
    JSON.stringify(
      {
        autoLoading: true,
        debounceMilliseconds: 1000,
        rapidEditsProduceOneCall: true,
        noSaveOnEntry: true,
        discoveryAndSaveCommandsInterceptedBeforeExecution: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Passed: real key-entry UI triggers one debounced discovery call and no save; test requests were intercepted.",
  );
} finally {
  if (breakpointId)
    await session
      .send("Debugger.removeBreakpoint", { breakpointId })
      .catch(() => {});
  await session.send("Debugger.disable").catch(() => {});
  await session.detach().catch(() => {});
  await page.reload().catch(() => {});
  await browser.close();
}
