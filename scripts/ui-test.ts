import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { complexFixture } from "../tests/fixture";
import { buildProject } from "../src/exporter/project-builder";
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync } from "node:fs";
import { BUILD_ID } from "../src/plugin/version";

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      acceptDownloads: true,
    });
    const exceptions: string[] = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => exceptions.push(error.message));
    await page.goto(pathToFileURL(resolve("dist/ui.html")).href);
    await page.evaluate((build) => {
      const relay = document.createElement("iframe");
      document.body.appendChild(relay);
      window.dispatchEvent(
        new MessageEvent("message", {
          source: relay.contentWindow,
          data: { pluginMessage: { type: "pong", build, busy: false } },
        }),
      );
      relay.remove();
    }, BUILD_ID);
    await page
      .getByText(`Connected to Figma · Build ${BUILD_ID}`, { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Export ZIP" }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Analyze Selection" }).click();
    await page.getByText("Analysis 0%", { exact: true }).waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: null,
          data: { pluginMessage: { type: "progress", count: 5, total: 10 } },
        }),
      ),
    );
    await page.getByText("Analysis 50%", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator("#progress-bar")
        .evaluate((node) => (node as HTMLProgressElement).value),
      50,
    );
    await page.evaluate(() =>
      window.postMessage(
        { pluginMessage: { type: "error", message: "Test interruption" } },
        "*",
      ),
    );
    await page.getByRole("button", { name: "Analyze Page" }).click();
    await page.getByText("Analysis 0%", { exact: true }).waitFor();
    const doc = complexFixture(),
      result = buildProject(doc);
    const serialized = Object.fromEntries(
      Object.entries(result.files).map(([key, value]) => [
        key,
        typeof value === "string" ? value : Array.from(value),
      ]),
    );
    await page.evaluate(
      ({ doc, files, errors }) => {
        const hydrated = Object.fromEntries(
          Object.entries(files).map(([key, value]) => [
            key,
            Array.isArray(value) ? new Uint8Array(value) : value,
          ]),
        );
        window.postMessage(
          { pluginMessage: { type: "result", doc, files: hydrated, errors } },
          "*",
        );
      },
      { doc, files: serialized, errors: result.errors },
    );
    await page.getByText("Ready to preview and export.").waitFor();
    await page.getByText("Analysis 100%", { exact: true }).waitFor();
    const frame = page.frameLocator("#frame");
    await frame
      .getByRole("heading", { name: "Make room for better ideas." })
      .waitFor();
    await frame
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(
          images.map((image) => (image as HTMLImageElement).decode()),
        ),
      );
    assert.equal(
      await frame
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      true,
    );
    await page.selectOption("#pages", "pages/about.html");
    await frame.getByRole("heading", { name: "About the studio" }).waitFor();
    await page.selectOption("#pages", "index.html");
    await page
      .getByRole("button", { name: "Expand canvas", exact: true })
      .click();
    await page.locator("#edit-mode").check();
    const heading = frame.getByRole("heading", {
      name: "Make room for better ideas.",
    });
    await heading.click();
    await page.waitForFunction(
      () =>
        !(document.getElementById("edit-fields") as HTMLFieldSetElement)
          .disabled,
    );
    await heading.scrollIntoViewIfNeeded();
    const box = await heading.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 55, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await page
      .getByText("Layout corrections saved for export.", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#edit-x").inputValue(), "35");
    await page.locator("#edit-width").fill("600");
    await page.locator("#edit-font").fill("44");
    await page.locator("#edit-text").fill("Adjusted heading");
    await page.waitForTimeout(500); // Debounced live edits, no Apply button.
    await frame.getByRole("heading", { name: "Adjusted heading" }).waitFor();
    await frame.locator("body").evaluate(
      () =>
        new Promise<void>((resolve) => {
          if (document.readyState === "complete") resolve();
          else addEventListener("load", () => resolve());
        }),
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await frame
      .getByRole("heading", { name: "Make room for better ideas." })
      .waitFor();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await frame.getByRole("heading", { name: "Adjusted heading" }).waitFor();
    await frame.getByRole("heading", { name: "Adjusted heading" }).click();
    const resize = frame.getByTitle("Drag to resize");
    const resizeBox = await resize.boundingBox();
    assert.ok(resizeBox);
    await page.mouse.move(resizeBox.x + 9, resizeBox.y + 9);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + 29, resizeBox.y + 19, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-width") as HTMLInputElement).value ===
        "620",
    );
    await page.selectOption("#pages", "pages/about.html");
    await frame.getByRole("heading", { name: "About the studio" }).waitFor();
    await page.selectOption("#pages", "index.html");
    await frame.getByRole("heading", { name: "Adjusted heading" }).waitFor();
    await page.screenshot({
      path: "test-output/plugin-ui.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Exit expanded canvas" }).click();
    await page.selectOption("#edit-layer", { label: "Headline · h1" });
    await frame.getByTitle("Drag to resize").waitFor();
    await page.locator("#edit-color").fill("#ff9900");
    await page.locator("#edit-rotation").fill("15");
    await page.selectOption("#edit-align", "center");
    await page.selectOption("#edit-words", "stack");
    await page.waitForTimeout(500); // Debounced live edits, no Apply button.
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-text") as HTMLTextAreaElement).value ===
        "Adjusted\nheading",
    );
    await frame
      .getByRole("heading", { name: "Adjusted heading" })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        if (
          style.color !== "rgb(255, 153, 0)" ||
          style.rotate !== "15deg" ||
          style.textAlign !== "center" ||
          style.whiteSpace !== "pre-wrap"
        )
          throw new Error("Text styling was not rendered");
      });
    await page.selectOption("#edit-words", "row");
    await page.waitForTimeout(500); // Debounced live edits, no Apply button.
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-text") as HTMLTextAreaElement).value ===
        "Adjusted heading",
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export ZIP" }).click();
    const download = await downloadEvent;
    await download.saveAs("test-output/ui-download.zip");
    const archive = unzipSync(readFileSync("test-output/ui-download.zip"));
    assert.match(strFromU8(archive["website/index.html"]), /Adjusted heading/);
    assert.match(
      strFromU8(archive["website/css/styles.css"]),
      /translate: 35px 20px/,
    );
    assert.match(strFromU8(archive["website/css/styles.css"]), /width: 620px/);
    assert.match(
      strFromU8(archive["website/css/styles.css"]),
      /color: #ff9900/,
    );
    assert.match(strFromU8(archive["website/css/styles.css"]), /rotate: 15deg/);
    assert.match(
      strFromU8(archive["website/css/styles.css"]),
      /text-align: center/,
    );
    assert.doesNotMatch(
      strFromU8(archive["website/index.html"]),
      /exporterEditor|Drag to resize/,
    );
    await page
      .getByRole("button", { name: "Expand canvas", exact: true })
      .click();
    await page.locator("#edit-mode").uncheck();
    await page.selectOption("#edit-layer", { label: "Hero · section" });
    assert.equal(await page.locator("#edit-mode").isChecked(), true);
    await page.selectOption("#width", "1920px");
    await page.selectOption("#canvas-zoom", "0.5");
    await frame.getByTitle("Drag to resize").waitFor();
    const childBox = await frame
      .getByRole("heading", { name: "Adjusted heading" })
      .boundingBox();
    assert.ok(childBox);
    await page.mouse.move(childBox.x + 20, childBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(childBox.x + 40, childBox.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-x") as HTMLInputElement).value === "40",
    );
    assert.equal(await page.locator("#edit-y").inputValue(), "20");
    assert.equal(
      await page.locator("#edit-layer option:checked").innerText(),
      "Hero · section",
    );
    assert.ok(
      (await page.locator("#canvas-viewport").boundingBox())!.height > 700,
    );
    await page.screenshot({ path: "test-output/canvas-editor.png" });
    await page.selectOption("#canvas-zoom", "1");
    const panBox = await frame
      .getByRole("heading", { name: "Adjusted heading" })
      .boundingBox();
    assert.ok(panBox);
    await page.mouse.click(panBox.x + 80, panBox.y + 20);
    await page.keyboard.down("Space");
    await page.mouse.move(panBox.x + 80, panBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(panBox.x + 40, panBox.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.waitForFunction(
      () => document.getElementById("canvas-viewport")!.scrollLeft >= 39,
    );
    assert.equal(await page.locator("#edit-x").inputValue(), "40");
    await page.getByRole("button", { name: "Exit expanded canvas" }).click();

    await page.evaluate(
      ({ doc, files }) =>
        window.postMessage(
          {
            pluginMessage: {
              type: "result",
              doc,
              files: Object.fromEntries(
                Object.entries(files).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? new Uint8Array(value) : value,
                ]),
              ),
              errors: [],
            },
          },
          "*",
        ),
      { doc, files: serialized },
    );
    await page.getByText("Ready to preview and export.").waitFor();
    assert.equal(await page.locator("#source-view").count(), 0);
    assert.equal(await page.locator("#edit-apply").count(), 0);
    await page.selectOption("#width", "100%");
    await page.selectOption("#canvas-zoom", "1");
    await page
      .getByRole("button", { name: "Expand canvas", exact: true })
      .click();
    await page.selectOption("#edit-layer", { label: "Headline · h1" });
    const title = frame.getByRole("heading", {
      name: "Make room for better ideas.",
    });
    const subtitle = frame.getByText(
      "An independent website built from a structured design.",
      { exact: true },
    );
    await subtitle.click({ modifiers: ["Shift"] });
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-layer") as HTMLSelectElement)
          .selectedOptions.length === 2,
    );
    const titleBox = await title.boundingBox();
    assert.ok(titleBox);
    await page.mouse.move(titleBox.x + 40, titleBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(titleBox.x + 60, titleBox.y + 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-x") as HTMLInputElement).value === "20",
    );
    await title.evaluate((element) => {
      if (getComputedStyle(element).translate !== "20px 10px")
        throw Error("Title did not move");
    });
    await subtitle.evaluate((element) => {
      if (getComputedStyle(element).translate !== "20px 10px")
        throw Error("Second selection did not move");
    });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-x") as HTMLInputElement).value === "0",
    );
    await page.keyboard.press("Control+Shift+z");
    await page.waitForFunction(
      () =>
        (document.getElementById("edit-x") as HTMLInputElement).value === "20",
    );
    await page.locator("#edit-color").fill("#12ab34");
    await page.waitForTimeout(500);
    await title.evaluate((element) => {
      if (getComputedStyle(element).color !== "rgb(18, 171, 52)")
        throw Error("Live colour not applied");
    });
    await subtitle.evaluate((element) => {
      if (getComputedStyle(element).color !== "rgb(18, 171, 52)")
        throw Error("Bulk colour not applied");
    });
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    await title.evaluate((element) => {
      if (getComputedStyle(element).color === "rgb(18, 171, 52)")
        throw Error("Sidebar undo failed");
    });
    await title.dblclick();
    await page
      .getByRole("dialog", { name: "Text colour", exact: true })
      .waitFor();
    await page.locator("#quick-colour").evaluate((input) => {
      (input as HTMLInputElement).value = "#112233";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#quick-colour-close").click();
    await expect(title).toHaveCSS("color", "rgb(17, 34, 51)");
    await page.selectOption("#edit-layer", [
      { label: "Headline · h1" },
      { label: "Introduction · p" },
    ]);
    await page.locator("#edit-delete").click();
    await title.waitFor({ state: "detached" });
    assert.equal(await subtitle.count(), 0);
    await page.keyboard.press("Control+z");
    await title.waitFor();
    await subtitle.waitFor();
    await title.click();
    await page.keyboard.press("Delete");
    await title.waitFor({ state: "detached" });
    await page.keyboard.press("Control+z");
    await title.waitFor();
    const cards = frame.locator("article");
    await cards.first().scrollIntoViewIfNeeded();
    const firstCard = await cards.nth(0).boundingBox(),
      secondCard = await cards.nth(1).boundingBox();
    assert.ok(firstCard && secondCard);
    await page.keyboard.down("Control");
    await page.mouse.move(firstCard.x - 2, firstCard.y - 2);
    await page.mouse.down();
    await page.mouse.move(
      secondCard.x + secondCard.width + 2,
      secondCard.y + secondCard.height + 2,
      { steps: 4 },
    );
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.waitForFunction(() =>
      Array.from(
        (document.getElementById("edit-layer") as HTMLSelectElement)
          .selectedOptions,
      ).some((option) => option.textContent === "Card 2 · article"),
    );
    const selectedLabels = await page
      .locator("#edit-layer option:checked")
      .allTextContents();
    assert.ok(selectedLabels.includes("Card 1 · article"));
    assert.ok(!selectedLabels.includes("Card 3 · article"));
    await page.locator("#prototype-mode").check();
    await frame.getByRole("link", { name: "Explore details" }).click();
    await frame.getByRole("heading", { name: "About the studio" }).waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await title.waitFor();
    await page.locator("#prototype-mode").uncheck();
    await page.getByRole("button", { name: "Exit expanded canvas" }).click();

    await page.locator("#layer-search").fill("headline");
    assert.equal(
      await page
        .locator("#edit-layer option")
        .evaluateAll(
          (options) =>
            options.filter((option) => !(option as HTMLOptionElement).hidden)
              .length,
        ),
      1,
    );
    await page.selectOption("#edit-layer", { label: "Headline · h1" });
    await page.locator("#layer-search").fill("");
    await page.locator("#edit-family").fill("Georgia, serif");
    await page.selectOption("#edit-weight", "700");
    await page.selectOption("#edit-font-style", "italic");
    await page.selectOption("#edit-decoration", "underline");
    await page.waitForTimeout(500);
    await title.evaluate((element) => {
      const style = getComputedStyle(element);
      if (
        !style.fontFamily.includes("Georgia") ||
        style.fontWeight !== "700" ||
        style.fontStyle !== "italic" ||
        !style.textDecorationLine.includes("underline")
      )
        throw Error("Font controls failed");
    });
    await title.hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      () =>
        (document.getElementById("canvas-zoom") as HTMLSelectElement).value ===
        "1.5",
    );
    await title.hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      () =>
        (document.getElementById("canvas-zoom") as HTMLSelectElement).value ===
        "1",
    );
    await page.locator("#auto-responsive").click();
    await page
      .getByRole("button", { name: "Responsive enabled · all pages" })
      .waitFor();
    for (const width of [375, 768, 1920]) {
      await page.selectOption("#width", width + "px");
      await frame.locator("body").evaluate(() => {
        if (document.documentElement.scrollWidth > innerWidth + 1)
          throw Error("Responsive horizontal overflow at " + innerWidth);
      });
    }
    await page.locator("#code-open").click();
    await page.selectOption("#code-file", "index.html");
    const generatedHtml = await page.locator("#code-content").inputValue();
    await page
      .locator("#code-content")
      .fill(
        generatedHtml.replace(
          "Make room for better ideas.",
          "Code edited heading",
        ),
      );
    await page.waitForTimeout(500);
    await frame.getByRole("heading", { name: "Code edited heading" }).waitFor();
    await page.selectOption("#code-file", "css/styles.css");
    const generatedCss = await page.locator("#code-content").inputValue();
    await page
      .locator("#code-content")
      .fill(generatedCss + "\nbody { background: #fedcba; }\n");
    await page.waitForTimeout(500);
    await frame.locator("body").evaluate((element) => {
      if (getComputedStyle(element).backgroundColor !== "rgb(254, 220, 186)")
        throw Error("Code CSS not previewed");
    });
    await page
      .locator("#code-content")
      .fill("body { color: definitely-not-a-colour; }");
    await page.waitForFunction(
      () => (document.getElementById("export") as HTMLButtonElement).disabled,
    );
    assert.match(
      await page.locator("#code-errors").innerText(),
      /css\/styles.css/,
    );
    await page
      .locator("#code-content")
      .fill(generatedCss + "\nbody { background: #fedcba; }\n");
    await page.waitForFunction(
      () => !(document.getElementById("export") as HTMLButtonElement).disabled,
    );
    await page.locator("#code-add-js").click();
    await page
      .locator("#code-content")
      .fill("'use strict';\ndocument.body.dataset.customCode = 'yes';\n");
    await page.locator("#code-close").click();
    const codeDownloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export ZIP" }).click();
    await (await codeDownloadEvent).saveAs("test-output/code-edited.zip");
    const codeArchive = unzipSync(readFileSync("test-output/code-edited.zip"));
    assert.match(
      strFromU8(codeArchive["website/index.html"]),
      /Code edited heading/,
    );
    assert.match(strFromU8(codeArchive["website/js/script.js"]), /customCode/);
    assert.match(strFromU8(codeArchive["website/css/styles.css"]), /fedcba/);
    assert.match(
      strFromU8(codeArchive["website/css/responsive.css"]),
      /Automatic responsive reflow/,
    );
    await page.evaluate(
      ({ doc, files }) =>
        window.postMessage(
          {
            pluginMessage: {
              type: "result",
              doc,
              files,
              errors: ["Missing asset"],
            },
          },
          "*",
        ),
      { doc, files: serialized },
    );
    await page.getByText("Validation failed. Review diagnostics.").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Export ZIP" }).isDisabled(),
      true,
    );
    assert.deepEqual(exceptions, []);
    console.log(
      "UI browser checks passed: preview, page switching, binary images, actual ZIP download, validation blocking.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
