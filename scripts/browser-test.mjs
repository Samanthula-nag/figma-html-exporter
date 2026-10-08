import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    pathToFileURL(resolve("test-output/website/index.html")).href,
  );
  for (const width of [375, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `test-output/website-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}`,
    );
    assert.equal(
      await page
        .locator("img")
        .evaluateAll((images) =>
          images.every((i) => i.complete && i.naturalWidth > 0),
        ),
      true,
    );
  }
  await page.getByRole("link", { name: "Explore details" }).click();
  await page.getByRole("heading", { name: "About the studio" }).waitFor();
  await page.getByRole("button", { name: "Go back" }).click();
  await page
    .getByRole("heading", { name: "Make room for better ideas." })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: 375/768/1440/1920px, images, internal navigation, history behavior, no console exceptions.",
  );
} finally {
  await browser.close();
}
