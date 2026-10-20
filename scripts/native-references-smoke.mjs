// Real WebView2 reference UI and native extraction/context integration.
// Uses generated local fixtures and a loopback model; no paid inference.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

let lastPayload;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  assert.equal(req.url, "/api/chat");
  lastPayload = JSON.parse(body);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      message: { content: "Review the attached requirements first." },
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
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
assert.equal(
  (await invoke("list_references")).length,
  0,
  "Use a session without attached references for this check",
);
const fixture = await mkdtemp(resolve(tmpdir(), "coco-reference-test-"));
await mkdir("artifacts", { recursive: true });
await writeFile(
  resolve(fixture, "requirements.md"),
  'Role requires Rust and C# experience.\napi_key = "test-private-value"',
);
await writeFile(resolve(fixture, ".cocoignore"), "excluded.txt\n");
await writeFile(resolve(fixture, "excluded.txt"), "EXCLUDED_CONTENT");
await writeFile(resolve(fixture, "unsupported.docx"), Buffer.from([0, 1, 2]));
const stream = "BT /F1 12 Tf 72 720 Td (CoCo PDF reference) Tj ET";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [];
for (const [i, object] of objects.entries()) {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = pdf.length;
pdf +=
  "xref\n0 6\n0000000000 65535 f \n" +
  offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
  `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(resolve(fixture, "brief.pdf"), pdf);
try {
  await invoke("save_settings", {
    settings: {
      ...initial,
      provider: "ollama",
      model: "fixture",
      localUrl: `http://127.0.0.1:${server.address().port}`,
      reasoningEffort: "auto",
      theme: "system",
      speakAnswers: false,
    },
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  await page.getByRole("button", { name: "References", exact: false }).click();
  async function add(kind, source) {
    await page.getByLabel("Reference type").selectOption(kind);
    await page.locator("#reference-source").fill(source);
    await page
      .getByRole("button", { name: "Add reference", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("references attached");
    await expect(page.locator("#reference-source")).toHaveValue("");
  }
  await add("file", resolve(fixture, "brief.pdf"));
  await expect(page.locator(".reference-item pre").first()).toContainText(
    "CoCo PDF reference",
  );
  await add("folder", fixture);
  await add(
    "text",
    'Use this job description to tailor the coding session.\napi_key = "test-private-value"',
  );
  await add("link", "https://127.0.0.1/job");
  await expect(page.locator(".reference-error")).toContainText(
    "public internet",
  );
  const refs = await invoke("list_references");
  assert.equal(refs.length, 4);
  assert.ok(
    !refs.some(
      (r) =>
        r.text.includes("test-private-value") ||
        r.text.includes("EXCLUDED_CONTENT"),
    ),
  );
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page
      .locator(".reference-item details")
      .first()
      .evaluate((e) => (e.open = true));
    await page.locator(".reference-item").first().scrollIntoViewIfNeeded();
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: `artifacts/native-references-${theme}.png` });
  }
  await page
    .getByRole("button", { name: "Close references", exact: true })
    .click();
  const ask = () =>
    invoke("ask_coach", {
      goal: "Fixture coaching",
      question: "What should I do next?",
      useScreen: false,
      useRepository: false,
    });
  await ask();
  let sent = lastPayload.messages.at(-1).content;
  assert.ok(
    sent.includes("CoCo PDF reference") &&
      sent.includes("Role requires Rust") &&
      sent.includes("Use this job description"),
  );
  assert.ok(
    !sent.includes("test-private-value") && !sent.includes("EXCLUDED_CONTENT"),
  );
  for (const ref of refs)
    await invoke("update_reference", { id: ref.id, action: "toggle" });
  await ask();
  sent = lastPayload.messages.at(-1).content;
  assert.ok(
    !sent.includes("CoCo PDF reference") &&
      !sent.includes("Role requires Rust") &&
      !sent.includes("Use this job description"),
  );
  await writeFile(resolve(fixture, "brief.pdf"), "damaged PDF");
  const refreshed = await invoke("update_reference", {
    id: refs[0].id,
    action: "refresh",
  });
  assert.equal(
    refreshed[0].text,
    "",
    "Failed refresh must discard stale extracted text",
  );
  for (const ref of await invoke("list_references"))
    await invoke("update_reference", { id: ref.id, action: "remove" });
  for (let i = 0; i < 8; i++)
    await invoke("add_reference", {
      kind: "text",
      source: `Bounded fixture ${i}`,
    });
  await assert.rejects(
    invoke("add_reference", { kind: "text", source: "Ninth attachment" }),
  );
  if (process.env.COCO_TEST_PUBLIC_REFERENCE === "1") {
    for (const ref of await invoke("list_references"))
      await invoke("update_reference", { id: ref.id, action: "remove" });
    const publicRefs = await invoke("add_reference", {
      kind: "link",
      source: "https://example.com",
    });
    assert.ok(
      publicRefs[0].text.includes("Example Domain"),
      publicRefs[0].note,
    );
    console.log("Public HTTPS retrieval passed (example.com only).");
  }
  const previous = (await invoke("load_workspace")).activeId;
  const previousRefs = (await invoke("list_references")).length;
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect
    .poll(async () => (await invoke("list_references")).length)
    .toBe(0);
  assert.equal(
    (await invoke("get_session", { id: previous })).references.length,
    previousRefs,
  );
  console.log(
    "Passed: PDF/folder/text/link references, both themes/axe, redaction/ignores, context inclusion/exclusion, failed refresh, removal, attachment cap, and separate new session.",
  );
} finally {
  for (const ref of await invoke("list_references"))
    await invoke("update_reference", { id: ref.id, action: "remove" }).catch(
      () => {},
    );
  await invoke("save_settings", {
    settings: initial,
    apiKey: null,
    clearKey: false,
  });
  await page.reload();
  await browser.close();
  server.close();
  assert.ok(fixture.startsWith(resolve(tmpdir(), "coco-reference-test-")));
  await rm(fixture, { recursive: true, force: true });
}
