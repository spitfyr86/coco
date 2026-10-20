// Use an isolated COCO_DATA_DIR and WebView2 profile. Seed, restart app, then resume.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

if (process.env.COCO_ISOLATED_SESSION_TEST !== "1")
  throw new Error("An isolated session store is required.");
const root = resolve(".local/saved-sessions-test");
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
const panel = () => page.getByRole("tabpanel");
const tab = (name) => page.getByRole("tab", { name, exact: true });
async function waitSaved() {
  await expect(page.locator(".save-state")).toHaveText("Saved locally");
}
let server;
try {
  await expect(panel().getByLabel("What are we working on?")).toBeVisible();
  if (process.env.COCO_TEST_PHASE === "resume") {
    const expected = JSON.parse(
      await readFile(resolve(root, "expected.json"), "utf8"),
    );
    const a = await invoke("get_session", { id: expected.a });
    const b = await invoke("get_session", { id: expected.b });
    assert.equal(a.document.messages.at(-1).text, "Guidance for session A.");
    assert.equal(b.document.draft, "Unfinished message B");
    assert.equal(b.document.goal, "Session B goal");
    assert.equal(a.context.number, 0);
    assert.equal(a.references[0].text, "");
    assert.ok(a.references[0].note.includes("Refresh"));
    await tab("Work A").click();
    await expect(
      panel().getByText("Guidance for session A.", { exact: true }),
    ).toBeVisible();
    await tab("Session B goal").click();
    await expect(panel().getByLabel("Message CoCo")).toHaveValue(
      "Unfinished message B",
    );
    await page
      .getByRole("button", { name: "Session history", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete Session B goal", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Delete saved session?",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Keep session", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    assert.ok(
      (await invoke("load_workspace")).sessions.some(
        (s) => s.id === expected.b,
      ),
    );
    await page
      .getByRole("button", { name: "Session history", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete Session B goal", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete session", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await invoke("load_workspace")).sessions.some(
          (s) => s.id === expected.b,
        ),
      )
      .toBe(false);
    const files = await readdir(resolve(root, "data/sessions"));
    assert.ok(
      !files.some(
        (name) => name === `${expected.b}.json` || name === `${expected.b}.bak`,
      ),
    );
    console.log(
      "Passed: process-restart history/draft recovery, stale-context handling, reference locations without bodies, safe delete default, explicit deletion and backup removal.",
    );
  } else {
    let release;
    let received;
    const requested = new Promise((r) => (received = r));
    server = createServer(async (req, res) => {
      let body = "";
      for await (const part of req) body += part;
      if (req.url !== "/api/chat") {
        res.writeHead(404);
        res.end();
        return;
      }
      const value = JSON.parse(body);
      assert.ok(value.messages.at(-1).content.includes("Question A"));
      assert.ok(
        value.messages.at(-1).content.includes("REFERENCE_BODY_DO_NOT_PERSIST"),
      );
      received();
      await new Promise((r) => (release = r));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          message: { content: "Guidance for session A." },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const settings = await invoke("load_settings");
    await invoke("save_settings", {
      settings: {
        ...settings,
        provider: "ollama",
        model: "fixture",
        localUrl: `http://127.0.0.1:${server.address().port}`,
        speakAnswers: false,
        reasoningEffort: "auto",
      },
      apiKey: null,
      clearKey: false,
    });
    await page.reload();
    const a = (await invoke("load_workspace")).activeId;
    await panel().getByLabel("What are we working on?").fill("Session A goal");
    await panel()
      .getByRole("switch", { name: "Include screen capture" })
      .click();
    await mkdir(root, { recursive: true });
    const file = resolve(root, "reference.txt");
    await writeFile(file, "REFERENCE_BODY_DO_NOT_PERSIST");
    await panel()
      .getByRole("button", { name: "References", exact: false })
      .click();
    await page.getByLabel("Reference type").selectOption("file");
    await page.getByLabel("File path").fill(file);
    await page
      .getByRole("button", { name: "Add reference", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "1 of 8 references attached" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close references", exact: true })
      .click();
    await panel().getByLabel("Message CoCo").fill("Question A");
    await waitSaved();
    await panel()
      .getByRole("button", { name: "Fresh check", exact: true })
      .click();
    await requested;
    await panel()
      .getByRole("button", { name: "New session", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    const b = (await invoke("load_workspace")).activeId;
    assert.notEqual(a, b);
    await panel().getByLabel("What are we working on?").fill("Session B goal");
    await panel().getByLabel("Message CoCo").fill("Unfinished message B");
    await waitSaved();
    assert.equal((await invoke("list_references", { sessionId: b })).length, 0);
    release();
    await expect
      .poll(
        async () =>
          (await invoke("get_session", { id: a })).document.messages.length,
      )
      .toBe(2);
    await expect(panel().getByLabel("Message CoCo")).toHaveValue(
      "Unfinished message B",
    );
    await expect(
      panel().getByText("Guidance for session A.", { exact: true }),
    ).toHaveCount(0);
    await tab("Session A goal").click();
    await expect(
      panel().getByText("Guidance for session A.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Session history", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Rename Session A goal", exact: true })
      .click();
    await page.getByLabel("Session name").fill("Work A");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await tab("Work A").press("Delete");
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(panel().getByLabel("Message CoCo")).toHaveValue(
      "Unfinished message B",
    );
    await page
      .getByRole("button", { name: "Session history", exact: true })
      .click();
    await page.getByRole("button", { name: /^Work A/ }).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
      panel().getByText("Guidance for session A.", { exact: true }),
    ).toBeVisible();
    const reopened = await invoke("get_session", { id: a });
    assert.equal(reopened.references[0].text, "");
    assert.equal(reopened.context.number, 0);
    await mkdir("artifacts", { recursive: true });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      await page.screenshot({ path: `artifacts/native-sessions-${theme}.png` });
    }
    const files = await readdir(resolve(root, "data/sessions"));
    for (const name of files.filter(
      (n) => n.endsWith(".json") || n.endsWith(".bak"),
    )) {
      assert.ok(
        !(
          await readFile(resolve(root, "data/sessions", name), "utf8")
        ).includes("REFERENCE_BODY_DO_NOT_PERSIST"),
      );
    }
    await writeFile(resolve(root, "expected.json"), JSON.stringify({ a, b }));
    console.log(
      "Passed: independent tabs/drafts/references, background reply routing, rename, close-with-history, reopening, both themes/axe, and no extracted bodies on disk. Restart the isolated app and run resume phase.",
    );
  }
} finally {
  await browser.close();
  server?.close();
}
