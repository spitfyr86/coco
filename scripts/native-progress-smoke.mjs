// Disposable profile only. Owned loopback provider; no paid inference.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
if (process.env.COCO_ISOLATED_PROGRESS_TEST !== "1")
  throw new Error("Disposable store required");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9245",
);
await expect
  .poll(
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .filter((p) => /1420|tauri.localhost/.test(p.url())).length,
    { timeout: 15000 },
  )
  .toBeGreaterThan(0);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /1420|tauri.localhost/.test(p.url()));
const invoke = (command, args) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const panel = () => page.locator('[role="tabpanel"]:not([hidden])');
const server = createServer(async (req, res) => {
  if (req.url !== "/api/chat") {
    req.resume();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: [] }));
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  const payload = JSON.parse(body);
  assert.ok(payload.messages.at(-1).content.includes("[x] Inspect failure"));
  assert.ok(payload.messages.at(-1).content.includes("[ ] Verify behavior"));
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      message: { content: "Continue with the verification milestone." },
      prompt_eval_count: 1,
      eval_count: 1,
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  const initial = await invoke("load_settings");
  await invoke("save_settings", {
    settings: {
      ...initial,
      provider: "ollama",
      model: "fixture",
      localUrl: `http://127.0.0.1:${server.address().port}`,
      speakAnswers: false,
    },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  const id = (await invoke("load_workspace")).activeId;
  await panel().getByLabel("What are we working on?").fill("Fix service error");
  await panel().getByRole("switch", { name: "Include screen capture" }).click();
  // Preserve coverage for legacy/user-corrected saved plans without requiring freeform setup in the UI.
  let document = (await invoke("get_session", { id })).document;
  await invoke("save_session_form", {
    id,
    form: {
      ...document,
      revision: document.formRevision + 100,
      pending: false,
      automaticProgress: false,
      milestones: ["Inspect failure", "Verify fix"].map((title) => ({
        id: crypto.randomUUID(),
        title,
        done: false,
        status: "not_started",
        manual: false,
        reason: "",
        evidence: "",
        checkpoint: null,
      })),
    },
  });
  await page.reload();
  await panel().locator(".progress-open").click();
  await page
    .getByLabel("Milestone 2 title", { exact: true })
    .fill("Verify behavior");
  await page.getByLabel("Milestone 2 title", { exact: true }).press("Enter");
  await page
    .getByRole("checkbox", { name: "Complete Inspect failure", exact: true })
    .check();
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    panel().getByRole("progressbar", { name: "Goal progress", exact: true }),
  ).toHaveAttribute("value", "1");
  await expect(
    panel().getByText("Next: Verify behavior", { exact: true }),
  ).toBeVisible();
  const splitter = panel().getByRole("separator", {
    name: "Resize context panel",
    exact: true,
  });
  await splitter.focus();
  await page.keyboard.press("Home");
  await expect(splitter).toHaveAttribute("aria-valuenow", "220");
  await page.keyboard.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", "230");
  await page.keyboard.press("End");
  const box = await splitter.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x - 55, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await invoke("get_session", { id })).document.contextWidth,
    )
    .toBeGreaterThan(300);
  const width = (await invoke("get_session", { id })).document.contextWidth;
  await panel().getByLabel("Message CoCo").fill("What should I do next?");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    panel().getByText("Continue with the verification milestone.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await panel()
    .getByRole("button", { name: "Collapse context panel", exact: true })
    .click();
  await expect(
    panel().getByRole("region", { name: "Session controls", exact: true }),
  ).toHaveCount(0);
  await panel().getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await invoke("get_session", { id })).document.contextCollapsed,
    )
    .toBe(true);
  await page.reload();
  await expect(
    panel().getByRole("button", { name: "Expand context panel", exact: true }),
  ).toBeVisible();
  await expect(
    panel().getByText("1 of 2 milestones complete", { exact: true }),
  ).toBeVisible();
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({
      path: `artifacts/progress-collapsed-${theme}.png`,
    });
  }
  await panel()
    .getByRole("button", { name: "Expand context panel", exact: true })
    .click();
  assert.equal(
    (await invoke("get_session", { id })).document.contextWidth,
    width,
  );
  assert.ok(
    Math.abs(
      (
        await panel()
          .getByRole("region", { name: "Session controls", exact: true })
          .boundingBox()
      ).width - width,
    ) < 2,
  );
  await page.screenshot({ path: "artifacts/progress-expanded.png" });
  await panel()
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "New session",
  );
  await expect(panel().getByRole("progressbar")).toHaveCount(1);
  await page
    .getByRole("tab", { name: "Fix service error", exact: true })
    .click();
  await expect(
    panel().getByText("1 of 2 milestones complete", { exact: true }),
  ).toBeVisible();
  console.log(
    "Passed: editable/completed milestones, progress persistence/isolation, plan in coaching payload, bounded drag/keyboard resize, collapse persistence, Settings access, both themes/axe.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
