// Native Ollama discovery and model-picker UI. No paid inference.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

let mode = "normal";
let requests = 0;
const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/show") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const name = JSON.parse(body).model;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        capabilities:
          name.includes("vision") || name.includes("stale")
            ? ["completion", "vision"]
            : name.includes("code")
              ? ["completion"]
              : [],
      }),
    );
    return;
  }
  assert.equal(req.url, "/api/tags");
  assert.equal(req.method, "GET");
  assert.equal(req.headers.authorization, undefined);
  requests++;
  const current = mode;
  if (current === "slow")
    await new Promise((resolve) => setTimeout(resolve, 1500));
  res.writeHead(current === "error" ? 503 : 200, {
    "Content-Type": "application/json",
  });
  const names =
    current === "empty"
      ? []
      : current === "slow"
        ? ["stale-model"]
        : ["fixture-vision:latest", "fixture-code:latest"];
  res.end(JSON.stringify({ models: names.map((name) => ({ name })) }));
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
assert.ok(page);
const invoke = (command, args) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const initial = await invoke("load_settings");
try {
  await invoke("save_settings", {
    settings: {
      ...initial,
      provider: "ollama",
      localUrl: endpoint,
      theme: "system",
      model: "saved-fixture",
      speakAnswers: false,
    },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  await mkdir("artifacts", { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Settings", exact: false }).click();
    await page.getByRole("tab", { name: "AI model", exact: true }).click();
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    await expect(model).toHaveValue("__recommended__");
    await expect(
      model.locator("option[value='__recommended__']"),
    ).toContainText("fixture-vision:latest");
    await expect(
      model.locator("option[value='fixture-code:latest']"),
    ).toHaveCount(0);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/native-models-${theme}.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  const screen = page.getByRole("switch", { name: "Include screen capture" });
  await screen.click();
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "AI model", exact: true }).click();
  await expect(
    page
      .getByLabel("Model", { exact: true })
      .locator("option[value='__recommended__']"),
  ).toContainText("fixture-code:latest");
  await expect(
    page
      .getByLabel("Model", { exact: true })
      .locator("option[value='fixture-vision:latest']"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await screen.click();
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "AI model", exact: true }).click();
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  const refresh = page.getByRole("button", { name: "Refresh models" });
  await expect(refresh).toBeEnabled();
  mode = "error";
  await refresh.click();
  await expect(page.getByRole("status")).toContainText("503");
  await expect(model).toHaveValue("__recommended__");
  mode = "empty";
  await refresh.click();
  await expect(page.getByRole("status")).toContainText("No verified");
  mode = "slow";
  const count = requests;
  await refresh.click();
  await expect.poll(() => requests).toBeGreaterThan(count);
  mode = "normal";
  await page.getByLabel("Server URL").fill(`${endpoint}/`);
  await refresh.click();
  await expect(model.locator("option[value='__recommended__']")).toContainText(
    "fixture-vision:latest",
  );
  await page.waitForTimeout(1700);
  await expect(model.locator("option[value='stale-model']")).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByRole("tab", { name: "AI model", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("__custom__");
  await page
    .getByLabel("Model ID", { exact: true })
    .fill("fixture-code:latest");
  await expect(
    page.getByRole("button", { name: "Save settings" }),
  ).toBeDisabled();
  await page
    .getByLabel("Model ID", { exact: true })
    .fill("custom-fixture-model");
  await page.getByRole("button", { name: "Save settings" }).click();
  assert.equal((await invoke("load_settings")).model, "custom-fixture-model");
  await writeFile(
    "artifacts/native-models-smoke.json",
    JSON.stringify(
      {
        themes: ["dark", "light"],
        accessibility: "passed",
        nativeOllamaCatalog: true,
        errorsAndEmptyList: true,
        unverifiedSavedModelReplacedWithRecommendation: true,
        filtersMatchScreenToggle: true,
        knownIncompatibleManualModelBlocked: true,
        staleResultsIgnored: true,
        openAICatalog:
          "Schema covered in Rust; live account catalog not tested",
        manualSave: true,
        requests,
      },
      null,
      2,
    ),
  );
  console.log(
    "Passed: native discovery, both themes/axe, errors, empty list, stale results, and manual save.",
  );
} finally {
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
