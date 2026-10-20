// Disposable native profile only; no external inference or credential changes.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
if (process.env.COCO_ISOLATED_SETTINGS_TEST !== "1")
  throw new Error("Disposable store required");
const browser = await chromium.connectOverCDP(
  process.env.COCO_CDP_URL || "http://127.0.0.1:9244",
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
const rootSize = () =>
  page
    .locator("html")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
const open = () =>
  page.getByRole("button", { name: "Settings", exact: false }).click();
const dialog = () =>
  page.getByRole("dialog", { name: "Settings", exact: true });
const size = () => page.getByRole("slider", { name: "Text size", exact: true });
async function setSize(value) {
  await size().fill(String(value));
}
try {
  const settings = await invoke("load_settings");
  assert.equal(settings.textSize, 100);
  await open();
  await expect(
    dialog().getByRole("tab", { name: "Appearance", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Increase text size", exact: true })
    .click();
  await expect(size()).toHaveValue("105");
  await setSize(150);
  await expect.poll(rootSize).toBe(24);
  const bodyFont = await page
    .locator("body")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert.equal(bodyFont, 19.5, "General text must scale along with chat");
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const name of ["Appearance", "AI model", "Voice", "API key"]) {
      await dialog().getByRole("tab", { name, exact: true }).click();
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      const overflow = await dialog().evaluate(
        (e) => e.scrollWidth > e.clientWidth + 1,
      );
      assert.equal(overflow, false, `${name}: horizontal overflow at 150%`);
    }
    await dialog()
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await page.screenshot({ path: `artifacts/settings-size-${theme}.png` });
  }
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  assert.equal((await invoke("load_settings")).textSize, 150);
  await page.reload();
  await expect.poll(rootSize).toBe(24);
  await open();
  await setSize(85);
  await expect.poll(rootSize).toBe(13.6);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(rootSize).toBe(24);
  await open();
  await page
    .getByRole("button", { name: "Reset to 100%", exact: true })
    .click();
  await expect(size()).toHaveValue("100");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  await expect.poll(rootSize).toBe(16);
  const invalid = await invoke("load_settings");
  await assert.rejects(
    invoke("save_settings", {
      settings: { ...invalid, textSize: 200 },
      apiKey: null,
      clearKey: false,
    }),
  );
  console.log(
    "Passed: settings sections, both themes/axe at 150%, general scaling, save/reload without a configured model, cancel rollback, reset, native bounds.",
  );
} finally {
  await browser.close();
}
