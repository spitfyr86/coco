// Development-only integration check against an already running CoCo WebView2.
// No external inference: this script owns a temporary loopback provider fixture.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const requests = [];
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "coco-fixture" }] }));
    return;
  }
  let body = "";
  if (req.method === "POST" && req.url === "/api/show") {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ capabilities: ["completion", "vision"] }));
    return;
  }
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  assert.equal(
    payload.model,
    "coco-fixture",
    "Recommended must resolve to a real model ID",
  );
  requests.push({
    image: !!payload.messages.at(-1).images?.length,
    context: payload.messages.at(-1).content,
    history: payload.messages.length,
  });
  if (payload.messages.at(-1).content.includes("simulate cancellation")) {
    req.on("close", () => {});
    return;
  }
  const json = JSON.stringify({
    message: {
      content:
        "Inspect the failing assertion first.\n\n```ts\nexpect(actual).toBe(expected);\n```\n\nThen rerun the focused test and share the result.",
    },
    prompt_eval_count: 24,
    eval_count: 18,
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(json);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9237",
);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /1420|tauri.localhost/.test(p.url()));
assert.ok(page, "CoCo webview not found");
await page.getByLabel("What are we working on?").waitFor();
const invoke = (command, args) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const initial = await invoke("load_settings");
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("artifacts", { recursive: true });
try {
  // Both-theme checks must also work when the user saved an explicit palette.
  await invoke("save_settings", {
    settings: { ...initial, theme: "system" },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  await page.getByLabel("What are we working on?").waitFor();
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    // OS emulation affects system theme without changing saved preferences.
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      theme,
    );
    const results = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      results.violations,
      [],
      `${theme} accessibility: ${results.violations.map((v) => v.id).join(", ")}`,
    );
    await page.screenshot({ path: `artifacts/coco-native-${theme}.png` });
  }
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "AI model", exact: true }).click();
  await page.getByLabel("AI provider").selectOption("ollama");
  await page.getByLabel("Server URL").fill(endpoint);
  await page.getByRole("button", { name: "Refresh models" }).click();
  await page
    .getByRole("option", { name: "Recommended — coco-fixture", exact: true })
    .waitFor({ state: "attached" });
  await page
    .getByLabel("Model", { exact: true })
    .selectOption("__recommended__");
  const speech = page.getByRole("switch", { name: "Read responses aloud" });
  if ((await speech.getAttribute("aria-checked")) === "true")
    await speech.click();
  const settingsAxe = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(settingsAxe.violations, [], "Settings accessibility");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page
    .getByLabel("What are we working on?")
    .fill("Investigate this fixture test failure");
  await page.getByRole("button", { name: "Fresh check", exact: true }).click();
  await page
    .getByText("Inspect the failing assertion first.")
    .waitFor({ timeout: 30_000 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].image, true);
  assert.ok(requests[0].context.includes("Checkpoint: 1"));
  await page
    .getByLabel("Message CoCo")
    .fill("Why should I inspect that assertion?");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".message.assistant").length === 2,
  );
  assert.equal(requests.length, 2);
  assert.ok(requests[1].context.includes("Checkpoint: 1"));
  assert.equal(requests[1].history, 4);
  await page.getByRole("button", { name: "Inspect shared context" }).click();
  await page.getByRole("button", { name: "Screen", exact: true }).click();
  assert.equal(
    await page.getByAltText("Screen captured for this checkpoint").count(),
    1,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "artifacts/coco-native-conversation.png" });
  const voices = await invoke("voice_status");
  assert.ok(voices.recognizers.length);
  // Verify the recognizer can open the real default microphone, without asking anyone to speak.
  const voiceEvents = [];
  await page.evaluate(() => {
    window.__cocoVoiceEvents = [];
  });
  const eventId = await page.evaluate(async () => {
    const handler = window.__TAURI_INTERNALS__.transformCallback(
      (event) => window.__cocoVoiceEvents.push(event.payload),
      false,
    );
    await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
      event: "voice-event",
      target: { kind: "Any" },
      handler,
    });
    return window.__TAURI_INTERNALS__.invoke("start_voice");
  });
  await page.waitForFunction(
    (id) =>
      window.__cocoVoiceEvents.some(
        (e) => e.id === id && (e.kind === "ready" || e.kind === "error"),
      ),
    eventId,
    { timeout: 20_000 },
  );
  voiceEvents.push(...(await page.evaluate(() => window.__cocoVoiceEvents)));
  await invoke("stop_voice", { cancel: false });
  await page.waitForFunction(
    (id) =>
      window.__cocoVoiceEvents.some(
        (e) => e.id === id && (e.kind === "result" || e.kind === "error"),
      ),
    eventId,
    { timeout: 10_000 },
  );
  const voiceReady = voiceEvents.some((e) => e.kind === "ready");
  assert.equal(voiceReady, true, "The default microphone did not become ready");
  await page.getByLabel("Message CoCo").fill("simulate cancellation");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "cancelled" }).waitFor();
  const summary = {
    themes: ["dark", "light"],
    accessibility: "passed",
    capture: "native JPEG preview",
    model: "loopback fixture, not real inference",
    completedRequests: 2,
    clarificationReusesCheckpoint: true,
    cancellation: true,
    voiceReady,
    voiceEvents,
    pageErrors: errors,
  };
  await writeFile(
    "artifacts/native-smoke.json",
    JSON.stringify(summary, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await invoke("stop_voice", { cancel: true }).catch(() => {});
  await invoke("stop_speaking").catch(() => {});
  await invoke("cancel_request").catch(() => {});
  await invoke("reset_session").catch(() => {});
  await invoke("save_settings", {
    settings: initial,
    apiKey: null,
    clearKey: false,
  }).catch(() => {});
  await page.reload().catch(() => {});
  server.closeAllConnections();
  server.close();
  await browser.close();
}
