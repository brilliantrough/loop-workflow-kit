import { expect, test } from "@playwright/test"

test("browses a run and previews a required Markdown artifact", async ({ page }, testInfo) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Run Library" })).toBeVisible()
  await expect(page.getByText("demo-workflow/demo-run", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: /demo-workflow\/demo-run/ }).click()
  await expect(page.getByRole("heading", { exact: true, name: "demo-workflow" })).toBeVisible()
  await page.getByRole("tab", { name: /artifacts/i }).click()
  await expect(page.getByText("present", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: /report\.md/ }).click()
  await expect(page.getByRole("heading", { name: "Fixture Report" })).toBeVisible()

  await page.getByTitle("Open full screen").click()
  const expandedPreview = page.locator(".artifact-preview.is-expanded")
  await expect(expandedPreview).toBeVisible()
  const bounds = await expandedPreview.boundingBox()
  expect(bounds?.width ?? 0).toBeGreaterThan(page.viewportSize()!.width * 0.8)
  await page.getByTitle("Exit full screen").click()

  await page.screenshot({ fullPage: true, path: testInfo.outputPath("artifact-preview.png") })
})

test("filters the run library without horizontal overflow", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("searchbox", { name: "Search workflow runs" }).fill("does-not-exist")
  await expect(page.getByRole("heading", { name: "No matching runs" })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
