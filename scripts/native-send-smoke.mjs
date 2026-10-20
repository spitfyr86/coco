// Run only with a disposable COCO_DATA_DIR/profile; no external inference.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import assert from "node:assert/strict";

if (process.env.COCO_ISOLATED_SEND_TEST !== "1")
  throw new Error("Isolated store required.");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9240",
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
const visible = () => invoke("plugin:window|is_visible", { label: "main" });
let count = 0;
const server = createServer(async (req, res) => {
  req.resume();
  if (req.url !== "/api/chat") {
    res.writeHead(404);
    res.end();
    return;
  }
  count++;
  // Assert the window has already returned while inference remains pending.
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await visible(), true);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      message: { content: `Fixture reply ${count}` },
      prompt_eval_count: 1,
      eval_count: 1,
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  const workspace = await invoke("load_workspace");
  const current = await invoke("get_session", { id: workspace.activeId });
  if (current.document.messages.length)
    await invoke("session_action", { action: "new", id: null, title: null });
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
  const panel = () => page.getByRole("tabpanel");
  await panel().getByLabel("What are we working on?").fill("Send regression");
  const source = (await invoke("list_sources")).find(
    (s) => s.kind === "monitor",
  );
  assert.ok(source);
  await panel()
    .getByRole("combobox", { name: /Screen|Capture source/ })
    .selectOption(source.id);
  await panel().getByLabel("Message CoCo").fill("First message by Enter");
  await panel().getByLabel("Message CoCo").press("Enter");
  await expect(
    panel().getByText("Fixture reply 1", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(await visible(), true);
  await panel().getByLabel("Message CoCo").fill("Second message by button");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    panel().getByText("Fixture reply 2", { exact: true }),
  ).toBeVisible();
  assert.equal(await visible(), true);
  await panel()
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "New session",
  );
  await panel()
    .getByLabel("What are we working on?")
    .fill("First Send button regression");
  await panel()
    .getByRole("combobox", { name: /Screen|Capture source/ })
    .selectOption(source.id);
  await panel().getByLabel("Message CoCo").fill("First message by Send button");
  await panel()
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    panel().getByText("Fixture reply 3", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(await visible(), true);
  await assert.rejects(
    invoke("refresh_context", {
      goal: "Test",
      query: "Test",
      sourceId: "window:0",
      includeRepository: false,
    }),
  );
  assert.equal(await visible(), true, "Capture errors must restore the window");
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("F2");
  await page
    .getByLabel("Session name", { exact: true })
    .fill("My custom session");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "My custom session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { selected: true })
    .locator(".tab-rename")
    .click();
  await page
    .getByLabel("Session name", { exact: true })
    .fill("Renamed from tab");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("tab", {
      name: "Renamed from tab",
      exact: true,
      selected: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Renamed from tab", exact: true, selected: true })
    .dblclick();
  await expect(
    page.getByRole("dialog", { name: "Rename session", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  }
  console.log(
    "Passed: Enter and Send, visible window during inference and after capture errors, editable persistent tab titles, both themes/axe. Loopback inference only.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
