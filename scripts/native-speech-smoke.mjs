// UI checks use a speech-command fixture: no paid synthesis or credential changes.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
if (process.env.COCO_ISOLATED_SPEECH_TEST !== "1")
  throw new Error("Disposable store required");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9241",
);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /1420|tauri.localhost/.test(p.url()));
const invoke = (command, args) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const cdp = await page.context().newCDPSession(page);
const speechCalls = [];
let breakpoint;
let interceptionError;
try {
  const initial = await invoke("load_settings");
  assert.equal(initial.speech.provider, "windows");
  await invoke("save_settings", {
    settings: {
      ...initial,
      provider: "ollama",
      model: "fixture",
      speakAnswers: false,
    },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  // Do not rely on this machine having credentials. Use an unsaved fixture key;
  // speech is intercepted before it can reach native HTTP or credential storage.
  await cdp.send("Debugger.enable");
  const reference = await cdp.send("Runtime.evaluate", {
    expression: "window.__TAURI_INTERNALS__.invoke",
  });
  cdp.on("Debugger.paused", async (event) => {
    try {
      const frame = event.callFrames[0];
      const payload = await cdp.send("Debugger.evaluateOnCallFrame", {
        callFrameId: frame.callFrameId,
        expression: "({speech:payload.speech,text:payload.text})",
        returnByValue: true,
      });
      speechCalls.push(payload.result.value);
      await cdp.send("Debugger.setVariableValue", {
        scopeNumber: frame.scopeChain.findIndex((s) => s.type === "local"),
        variableName: "cmd",
        newValue: { value: "__coco_speech_fixture_no_network__" },
        callFrameId: frame.callFrameId,
      });
    } catch (e) {
      interceptionError = e;
    } finally {
      await cdp.send("Debugger.resume").catch(() => {});
    }
  });
  ({ breakpointId: breakpoint } = await cdp.send(
    "Debugger.setBreakpointOnFunctionCall",
    { objectId: reference.result.objectId, condition: "cmd === 'speak'" },
  ));
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await expect(page.getByLabel("Speech provider", { exact: true })).toHaveValue(
    "windows",
  );
  await page
    .getByLabel("Speech provider", { exact: true })
    .selectOption("openai");
  await page.getByRole("tab", { name: "API key", exact: true }).click();
  await page
    .getByRole("textbox", { name: /^API key/ })
    .fill("unsaved-fixture-key");
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await page
    .getByLabel("Speaking voice", { exact: true })
    .selectOption("cedar");
  await page.getByLabel("Speaking speed", { exact: true }).selectOption("1.25");
  assert.equal(
    speechCalls.length,
    0,
    "Selecting options must never synthesize",
  );
  await page
    .getByRole("button", { name: "Preview voice", exact: true })
    .click();
  await expect.poll(() => speechCalls.length).toBe(1);
  assert.equal(interceptionError, undefined);
  const call = speechCalls[0];
  assert.equal(call.speech.provider, "openai");
  assert.equal(call.speech.voice, "cedar");
  assert.equal(call.speech.speed, 1.25);
  await page.getByRole("button", { name: "Stop preview", exact: true }).click();
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/speech-${theme}.png` });
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    (await invoke("load_settings")).speech.provider,
    "windows",
    "Cancel keeps Windows default",
  );
  const saved = await invoke("load_settings");
  await invoke("save_settings", {
    settings: {
      ...saved,
      speech: { provider: "openai", voice: "cedar", speed: 1.25 },
    },
    apiKey: null,
    clearKey: false,
  });
  assert.deepEqual((await invoke("load_settings")).speech, {
    provider: "openai",
    voice: "cedar",
    speed: 1.25,
  });
  await invoke("save_settings", {
    settings: saved,
    apiKey: null,
    clearKey: false,
  });
  const workspace = await invoke("load_workspace");
  await invoke("session_action", {
    action: "rename",
    id: workspace.activeId,
    title: "Debug API",
  });
  await invoke("session_action", {
    action: "new",
    id: workspace.activeId,
    title: null,
  });
  await page.reload();
  await page.getByRole("tab", { name: "Debug API", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Debug API", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "New session", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New session", exact: true }),
  ).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    const active = await page
      .getByRole("tab", { selected: true })
      .evaluate((e) => getComputedStyle(e.parentElement).backgroundColor);
    const inactive = await page
      .getByRole("tab", { selected: false })
      .evaluate((e) => getComputedStyle(e.parentElement).backgroundColor);
    assert.notEqual(active, inactive);
    await page.screenshot({ path: `artifacts/tabs-${theme}.png` });
  }
  console.log(
    "Passed: optional Windows default, explicit OpenAI preview contract, voice/speed/cost notice, cancel, active-tab ownership, both themes/axe. No paid synthesis.",
  );
} finally {
  if (breakpoint)
    await cdp
      .send("Debugger.removeBreakpoint", { breakpointId: breakpoint })
      .catch(() => {});
  await browser.close();
}
