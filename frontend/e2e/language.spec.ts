import { expect, test } from "@playwright/test";

test("new visitors get Croatian and can switch to English for good", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL as string;
  const visitor = await browser.newContext({ baseURL });
  try {
    const page = await visitor.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dobro došli natrag" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "hr");

    await page.getByLabel("Jezik").selectOption("en");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await visitor.close();
  }
});
