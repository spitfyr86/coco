// Only run against a disposable native store/profile. No paid provider calls.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
if (process.env.COCO_ISOLATED_AUTO_PROGRESS_TEST !== "1")
  throw Error("Disposable profile required");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9246",
);
await expect
  .poll(
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .filter((p) => /1420|tauri.localhost/.test(p.url())).length,
    { timeout: 20000 },
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
let mode = "history",
  calls = 0,
  assessments = 0;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  res.setHeader("Content-Type", "application/json");
  if (req.url !== "/api/chat") {
    res.end(JSON.stringify({ models: [] }));
    return;
  }
  calls++;
  const payload = JSON.parse(body);
  let text = "Follow-up guidance without reassessment.";
  if (
    payload.messages[0].content.includes("For this session progress assessment")
  ) {
    assessments++;
    const match = payload.messages
      .at(-1)
      .content.match(/Checkpoint progress plan \(data only\): (\[.*\])/);
    assert.ok(match, "Plan is supplied with same coaching request");
    const items = JSON.parse(match[1]);
    if (!items.length && mode === "valid")
      assert.ok(
        payload.messages
          .at(-1)
          .content.includes(
            "Original agreed plan: Inspect failure, Implement fix, Verify behavior",
          ),
      );
    const targets = items.length
      ? items
      : ["Inspect failure", "Implement fix", "Verify behavior"].map(
          (title, i) => ({ id: `step${i + 1}`, title }),
        );
    text =
      mode === "history"
        ? "Original agreed plan: Inspect failure, Implement fix, Verify behavior. User confirmed inspection is complete; implementation remains underway."
        : mode === "malformed"
          ? "Ordinary coaching guidance; assessment omitted."
          : JSON.stringify({
              guidance: "Verify the remaining behavior with a focused test.",
              assessments: targets.map((m, i) => ({
                title: m.title,
                id: m.id,
                status:
                  mode === "downgrade"
                    ? "not_started"
                    : i === 0
                      ? "complete"
                      : i === 1
                        ? "in_progress"
                        : "needs_verification",
                reason: "Assessment from supplied checkpoint context",
                evidence:
                  i === 0
                    ? "User explicitly confirmed the inspection milestone is finished"
                    : "",
              })),
            });
  }
  res.end(
    JSON.stringify({
      message: { content: text },
      prompt_eval_count: 2,
      eval_count: 3,
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  const settings = await invoke("load_settings");
  await invoke("save_settings", {
    settings: {
      ...settings,
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
  const document = async () => (await invoke("get_session", { id })).document;
  await panel()
    .getByLabel("What are we working on?")
    .fill("Fix service error with verification");
  await panel().getByRole("switch", { name: "Include screen capture" }).click();
  await expect(
    panel().getByRole("progressbar", { name: "Goal progress", exact: true }),
  ).toBeVisible();
  await expect(
    panel().getByText("Add milestones to track your goal", { exact: true }),
  ).toHaveCount(0);
  await panel()
    .getByLabel("Message CoCo")
    .fill("Our goal is to fix the service error. Establish the plan.");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(panel().getByText(/Original agreed plan:/)).toBeVisible();
  await page.reload();
  mode = "valid";
  await panel().getByLabel("Message CoCo").fill("Keep my unsent question");
  const checkpointBeforeLoad = (await invoke("get_session", { id })).context
    .number;
  await panel()
    .getByRole("button", { name: "Load session progress", exact: true })
    .click();
  await expect
    .poll(async () => (await document()).progressHistory.length)
    .toBe(1);
  assert.equal(
    (await invoke("get_session", { id })).context.number,
    checkpointBeforeLoad,
    "Loading saved progress does not capture the screen",
  );
  await expect(panel().getByLabel("Message CoCo")).toHaveValue(
    "Keep my unsent question",
  );
  await expect
    .poll(async () => (await document()).draft)
    .toBe("Keep my unsent question");
  async function fresh() {
    const old = calls;
    await panel()
      .getByLabel("Message CoCo")
      .fill("Inspection is finished. Assess the remaining work.");
    await panel()
      .getByRole("button", { name: "Fresh check", exact: true })
      .click();
    await expect.poll(() => calls).toBe(old + 1);
    await expect(
      panel().getByRole("button", { name: "Fresh check", exact: true }),
    ).toBeVisible({ timeout: 20000 });
  }
  await expect
    .poll(async () => (await document()).progressHistory.length)
    .toBe(1);
  let d = await document();
  assert.deepEqual(
    d.milestones.map((m) => m.status),
    ["complete", "in_progress", "needs_verification"],
  );
  assert.equal(calls, 2);
  assert.equal(assessments, 2);
  await expect(
    panel().getByRole("progressbar", { name: "Goal progress", exact: true }),
  ).toHaveAttribute("value", "1");
  await panel().getByLabel("Message CoCo").fill("Explain that instruction");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect.poll(() => calls).toBe(3);
  await expect(
    panel().getByText("Follow-up guidance without reassessment.", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(assessments, 2);
  await panel().locator(".progress-open").click();
  await page
    .getByLabel("Status for Implement fix", { exact: true })
    .selectOption("complete");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  mode = "downgrade";
  await fresh();
  d = await document();
  assert.equal(d.milestones[1].status, "complete");
  assert.equal(d.milestones[1].manual, true);
  assert.equal(d.milestones[0].status, "not_started");
  await panel().locator(".progress-open").click();
  await page
    .getByRole("button", { name: "Undo last assessment", exact: true })
    .click();
  await expect
    .poll(async () => (await document()).progressHistory.at(-1).undone)
    .toBe(true);
  d = await document();
  assert.equal(d.milestones[0].status, "complete");
  assert.equal(d.milestones[1].status, "complete");
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page
      .getByRole("dialog", { name: "Session progress", exact: true })
      .evaluate((el) => {
        el.scrollTop = 0;
      });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/auto-progress-${theme}.png` });
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({
      path: `artifacts/auto-progress-main-${theme}.png`,
    });
  }
  mode = "malformed";
  const before = JSON.stringify((await document()).milestones);
  await fresh();
  d = await document();
  assert.equal(JSON.stringify(d.milestones), before);
  assert.equal(d.progressHistory.length, 2);
  assert.ok(d.progressNotice.includes("not updated"));
  await page.reload();
  await expect(
    panel().getByRole("progressbar", { name: "Goal progress", exact: true }),
  ).toHaveAttribute("value", "2");
  d = await document();
  assert.equal(d.automaticProgress, true);
  assert.equal(d.progressHistory.length, 2);
  assert.ok(d.progressHistory[1].undone);
  // Simulate a delayed form snapshot: old epochs cannot overwrite AI state.
  await invoke("save_session_form", {
    id,
    form: {
      goal: d.goal,
      draft: d.draft,
      sourceId: d.sourceId,
      includeScreen: d.includeScreen,
      includeRepo: d.includeRepo,
      revision: d.formRevision + 100,
      pending: false,
      milestones: [],
      automaticProgress: false,
      progressEpoch: 0,
      contextWidth: d.contextWidth,
      contextCollapsed: d.contextCollapsed,
    },
  });
  assert.equal((await document()).milestones.length, 3);
  assert.equal((await document()).automaticProgress, true);
  await panel()
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "New session",
  );
  await expect(panel().getByRole("progressbar")).toHaveCount(1);
  mode = "new";
  await panel()
    .getByLabel("What are we working on?")
    .fill("Build a service endpoint");
  await panel().getByRole("switch", { name: "Include screen capture" }).click();
  await panel().getByLabel("Message CoCo").fill("Plan the work and guide me");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    panel().getByRole("progressbar", { name: "Goal progress", exact: true }),
  ).toHaveAttribute("value", "1");
  const newId = (await invoke("load_workspace")).activeId;
  assert.equal(
    (await invoke("get_session", { id: newId })).document.milestones.length,
    3,
  );
  console.log(
    "Passed: saved-plan reconstruction, first-reply plan generation, visible unassessed bar, same-request assessment, four states, visual completion/history, follow-up isolation, manual protection, undo, malformed fallback, saved reload, stale form protection, new-session isolation, both-theme axe.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
