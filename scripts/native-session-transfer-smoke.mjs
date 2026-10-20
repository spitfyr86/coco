import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
if (
  process.env.COCO_ISOLATED_TRANSFER_TEST !== "1" ||
  !process.env.COCO_TEST_APP_PID
)
  throw Error("Isolated profile and owned PID required");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9249",
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
const history = () =>
  page.getByRole("dialog", { name: "Session history", exact: true });
const fixture = path.resolve(".local/transfer-fixtures");
await mkdir(fixture, { recursive: true });
function driver(file, cancel = false) {
  return new Promise((resolve, reject) => {
    const args = [
      "-NoProfile",
      "-File",
      path.resolve("scripts/test-session-file-dialog.ps1"),
      "-AppProcessId",
      process.env.COCO_TEST_APP_PID,
    ];
    if (cancel) args.push("-Cancel");
    else args.push("-FilePath", file);
    const child = spawn("pwsh.exe", args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(output)),
    );
  });
}
async function dialogClick(button, file, cancel = false) {
  const drive = driver(file, cancel);
  await button.click();
  await drive;
}
try {
  const id = (await invoke("load_workspace")).activeId;
  await panel().getByLabel("What are we working on?").fill("Portable session");
  await panel().getByLabel("Message CoCo").fill("Keep my unsent draft");
  await expect
    .poll(async () => (await invoke("get_session", { id })).document.draft)
    .toBe("Keep my unsent draft");
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  const file = path.join(fixture, `session-${Date.now()}.json`);
  await dialogClick(
    history().getByRole("button", {
      name: "Export Portable session",
      exact: true,
    }),
    file,
  );
  await expect(
    history().getByText("Session exported.", { exact: true }),
  ).toBeVisible();
  const archive = JSON.parse(await readFile(file, "utf8"));
  assert.equal(archive.format, "coco.sessions");
  assert.equal(archive.sessions.length, 1);
  assert.equal(archive.sessions[0].draft, "Keep my unsent draft");
  assert.ok(!archive.settings);
  await dialogClick(
    history().getByRole("button", { name: "Import", exact: true }),
    file,
  );
  await expect(history().getByText(/Imported 1 session/)).toBeVisible();
  const ws = await invoke("load_workspace");
  assert.equal(ws.sessions.length, 2);
  assert.notEqual(ws.activeId, id);
  const imported = (await invoke("get_session", { id: ws.activeId })).document;
  assert.equal(imported.draft, "Keep my unsent draft");
  assert.equal(imported.includeRepo, false);
  const all = path.join(fixture, `all-${Date.now()}.json`);
  await dialogClick(
    history().getByRole("button", { name: "Export all", exact: true }),
    all,
  );
  await expect(
    history().getByText("All sessions exported.", { exact: true }),
  ).toBeVisible();
  assert.equal(JSON.parse(await readFile(all, "utf8")).sessions.length, 2);
  await dialogClick(
    history().getByRole("button", { name: "Import", exact: true }),
    null,
    true,
  );
  assert.equal((await invoke("load_workspace")).sessions.length, 2);
  const invalid = path.join(fixture, "invalid.json");
  await writeFile(
    invalid,
    '{"format":"coco.sessions","version":99,"sessions":[]}',
  );
  await dialogClick(
    history().getByRole("button", { name: "Import", exact: true }),
    invalid,
  );
  await expect(history().getByRole("alert")).toContainText("Unsupported");
  assert.equal((await invoke("load_workspace")).sessions.length, 2);
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/session-transfer-${theme}.png` });
  }
  await page
    .getByRole("button", { name: "Close session history", exact: true })
    .click();
  await page.reload();
  assert.equal(
    (await invoke("get_session", { id: ws.activeId })).document.draft,
    "Keep my unsent draft",
  );
  console.log(
    "Passed native file dialogs: export one/all, JSON contract, import as copies, draft persistence, cancel, invalid version without mutation, both-theme axe.",
  );
} finally {
  await browser.close();
}
