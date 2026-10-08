import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { complexFixture } from "../tests/fixture";
import { buildProject } from "../src/exporter/project-builder";
import { BUILD_ID } from "../src/plugin/version";
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(resolve("dist/ui.html")).href);
    const doc = complexFixture(),
      result = buildProject(doc);
    await page.evaluate(
      ({ doc, result, build }) => {
        window.postMessage(
          { pluginMessage: { type: "pong", build, busy: false } },
          "*",
        );
        window.postMessage(
          { pluginMessage: { type: "result", doc, ...result } },
          "*",
        );
      },
      { doc, result, build: BUILD_ID },
    );
    await expect(page.locator("#edit-layer option")).not.toHaveCount(0);
    await expect(page.locator("#canvas-viewport")).toBeVisible();
    const original = await page.locator("#canvas-viewport").boundingBox();
    if (!original || original.height < 600)
      throw new Error("Canvas does not fill window");
    await page
      .getByRole("button", { name: "Hide panels", exact: true })
      .click();
    const expanded = await page.locator("#canvas-viewport").boundingBox();
    if (!expanded || expanded.width <= original.width)
      throw new Error("Collapse failed");
    await page
      .getByRole("button", { name: "Show panels", exact: true })
      .click();
    await page.locator("#panel-splitter").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#panel-splitter")).toHaveAttribute(
      "aria-valuenow",
      "300",
    );
    await page.locator("#edit-layer").selectOption({ index: 2 });
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await expect(page.locator("#edit-fields")).toBeVisible();
    await page.screenshot({ path: "dist/workspace-preview.png" });
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(page.locator("#prepare-layout")).toBeVisible();
    await page.locator("#warning-count").click();
    await expect(page.locator("#warning-dialog")).toBeVisible();
    await page.locator("#warning-close").click();
    await page.setViewportSize({ width: 760, height: 620 });
    const small = await page.locator("#canvas-viewport").boundingBox();
    if (!small || small.width < 300 || small.height < 250)
      throw new Error("Small workspace unusable");
    // Smooth wheel zoom uses arbitrary values and keeps the pointer's document Y.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.locator("#canvas-zoom").selectOption("1");
    const body = page.frameLocator("#frame").locator("body");
    await body.evaluate(() => {
      document.body.style.minHeight = "4000px";
      window.scrollTo(0, 800);
    });
    await expect.poll(() => body.evaluate(() => window.scrollY)).toBe(800);
    await body.evaluate(() =>
      window.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -20,
          clientX: 200,
          clientY: 120,
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    );
    await expect
      .poll(async () => Number(await page.locator("#canvas-zoom").inputValue()))
      .toBeGreaterThan(1);
    const scale = Number(await page.locator("#canvas-zoom").inputValue());
    expect(scale).toBeLessThan(1.1);
    await expect
      .poll(async () =>
        Math.abs(
          (await body.evaluate(() => window.scrollY)) + 120 / scale - 920,
        ),
      )
      .toBeLessThan(2);
    await body.evaluate(() =>
      window.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 20,
          clientX: 200,
          clientY: 120,
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    );
    await expect
      .poll(async () => Number(await page.locator("#canvas-zoom").inputValue()))
      .toBeCloseTo(1, 5);
    const normalPrevented = await body.evaluate(() => {
      const e = new WheelEvent("wheel", { deltaY: 20, cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(normalPrevented).toBe(false);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Workspace checks passed: canvas sizing, panel collapse/resize, layer selection, inspector, diagnostics, narrow window.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
