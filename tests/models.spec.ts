import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: model discovery, key refresh, and manual fallback`, async ({
    page,
  }) => {
    let openAiCalls = 0;
    page.on("console", (message) => {
      if (message.text() === "fixture-catalog:openai") openAiCalls++;
    });
    // UI contract fixture; native HTTP discovery is tested separately in Rust.
    await page.addInitScript(() => {
      const choice = (
        id: string,
        vision: boolean | null = true,
        completion: boolean | null = true,
        rank = 0,
      ) => ({
        id,
        vision,
        completion,
        rank,
        size: 1,
        reason: "Fixture recommendation",
      });
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string, args?: Record<string, unknown>) => {
            const id = "00000000-0000-4000-8000-000000000001";
            const summary = {
              id,
              title: "New session",
              updatedAt: 1,
              open: true,
            };
            if (command === "load_workspace")
              return {
                sessions: [summary],
                openIds: [id],
                activeId: id,
                warning: "",
              };
            if (command === "get_session")
              return {
                document: {
                  version: 1,
                  id,
                  title: "New session",
                  customTitle: false,
                  goal: "",
                  draft: "",
                  root: null,
                  sourceId: "",
                  includeScreen: true,
                  includeRepo: true,
                  messages: [],
                  usage: { inputTokens: 0, outputTokens: 0, requests: 0 },
                  references: [],
                  createdAt: 1,
                  updatedAt: 1,
                  formRevision: 0,
                  lastCheckpoint: 0,
                },
                context: {
                  repository: null,
                  screen: null,
                  capturedAt: null,
                  number: 0,
                },
                references: [],
              };
            if (command === "save_session_form") return summary;
            if (command === "list_references") return [];
            if (command === "load_settings")
              return {
                provider: "ollama",
                model: "saved-model",
                reasoningEffort: "auto",
                localUrl: "http://127.0.0.1:11434",
                theme: "system",
                speakAnswers: false,
                hasApiKey: false,
              };
            if (command === "voice_status") return { recognizers: [] };
            if (command === "list_sources" || command === "shortcut_warnings")
              return [];
            if (command === "list_models") {
              console.debug(`fixture-catalog:${String(args?.provider)}`);
              if (args?.provider === "openai") {
                if (!args.apiKey)
                  throw new Error(
                    "Enter your OpenAI API key, then refresh models.",
                  );
                return [
                  choice("gpt-6.1-sol"),
                  choice("image-generator", false, false),
                  choice("unknown", null, null),
                ];
              }
              if (String(args?.localUrl).endsWith(":11435")) {
                await new Promise((resolve) => setTimeout(resolve, 800));
                return [choice("stale-server-model")];
              }
              if (String(args?.localUrl).endsWith(":11436"))
                return [choice("new-server-model")];
              return [
                choice("installed-vision:latest"),
                choice("installed-code:latest", false),
                choice("unknown", null, null),
              ];
            }
            if (command === "save_settings") return args?.settings;
            return false;
          },
        },
      });
    });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: false }).click();
    await page.getByRole("tab", { name: "AI model", exact: true }).click();
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    await expect(model).toHaveValue("__recommended__");
    await expect(
      model.locator("option[value='__recommended__']"),
    ).toContainText("installed-vision:latest");
    await expect(
      model.locator("option[value='installed-code:latest']"),
    ).toHaveCount(0);
    await expect(model.locator("option[value='unknown']")).toHaveCount(0);
    await page.getByLabel("Server URL").fill("http://127.0.0.1:11435");
    await page.waitForTimeout(100);
    await page.getByLabel("Server URL").fill("http://127.0.0.1:11436");
    await expect(
      model.locator("option[value='__recommended__']"),
    ).toContainText("new-server-model");
    await page.waitForTimeout(900);
    await expect(
      model.locator("option[value='stale-server-model']"),
    ).toHaveCount(0);
    await page.getByLabel("AI provider").selectOption("openai");
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "API key",
    );
    const beforeTyping = openAiCalls;
    await page.getByRole("tab", { name: "API key", exact: true }).click();
    await page.getByLabel("API key", { exact: true }).fill("test-only-key");
    await page.waitForTimeout(300);
    expect(openAiCalls).toBe(beforeTyping);
    await page
      .getByLabel("API key", { exact: true })
      .fill("test-only-key-edited");
    await page.getByRole("tab", { name: "AI model", exact: true }).click();
    await expect(
      model.locator("option[value='__recommended__']"),
    ).toContainText("gpt-6.1-sol");
    expect(openAiCalls).toBe(beforeTyping + 1);
    await expect(model.locator("option[value='image-generator']")).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Model ID", { exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `artifacts/models-${theme}.png` });
    await model.selectOption("__custom__");
    await page.getByLabel("Model ID", { exact: true }).fill("custom-model-id");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
