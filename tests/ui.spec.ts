import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: initial layout, keyboard interaction, and accessibility`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "A little clarity. Your next step." }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Work through a bug" }).click();
    await expect(page.getByLabel("What are we working on?")).toHaveValue(
      /investigate/,
    );
    await page.getByRole("button", { name: "Settings", exact: false }).click();
    await page.getByRole("tab", { name: "AI model", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByLabel("AI provider").selectOption("openai");
    await page.getByRole("tab", { name: "API key", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^API key/ })).toBeVisible();
    const dialogResults = await new AxeBuilder({ page }).analyze();
    expect(dialogResults.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/coco-${theme}.png` });
  });
}

test("browser preview cannot masquerade as a native coaching session", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("What are we working on?").fill("Fix the failing test");
  await page.getByRole("button", { name: "Fresh check" }).click();
  await expect(page.getByRole("alert")).toContainText("desktop app");
  await expect(page.getByLabel("Start voice input")).toBeDisabled();
  await expect(page.getByText("No checkpoint yet")).toBeVisible();
});
