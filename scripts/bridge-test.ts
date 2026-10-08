import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import { BUILD_ID } from "../src/plugin/version";

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1100 },
    });
    page.setDefaultTimeout(10000);
    const ui = readFileSync("dist/ui.html", "utf8");
    const incoming: string[] = [],
      outgoing: string[] = [];
    const pending: Promise<unknown>[] = [];
    const sizes: number[][] = [];
    let nodeChanged: (() => void) | undefined;
    const sourcePage: any = {
      on(type: string, callback: () => void) {
        if (type === "nodechange") nodeChanged = callback;
      },
      off() {
        nodeChanged = undefined;
      },
      id: "source-page",
      type: "PAGE",
      name: "Bridge fixture",
      selection: [],
    };
    const shape = {
      parent: sourcePage,
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      id: "shape",
      type: "RECTANGLE",
      name: "Card",
      width: 160,
      height: 3000,
      x: 0,
      y: 0,
      visible: true,
      fills: [],
      strokes: [],
      effects: [],
      exportAsync: async () =>
        new Uint8Array(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            "base64",
          ),
        ),
    };
    sourcePage.selection = [shape];
    const figma = {
      on() {},
      async getNodeByIdAsync(id: string) {
        return id === shape.id ? shape : null;
      },
      showUI() {},
      currentPage: sourcePage,
      ui: {
        resize(width: number, height: number) {
          sizes.push([width, height]);
        },
        onmessage: undefined as
          undefined | ((message: unknown) => Promise<void>),
        postMessage(message: {
          type: string;
          preview?: { bytes: Uint8Array };
        }) {
          outgoing.push(message.type);
          pending.push(
            page.evaluate(
              (payload) => {
                (
                  document.getElementById("plugin") as HTMLIFrameElement
                ).contentWindow!.postMessage({ pluginMessage: payload }, "*");
              },
              message.preview
                ? {
                    ...message,
                    preview: {
                      ...message.preview,
                      bytes: Array.from(message.preview.bytes),
                    },
                  }
                : message,
            ),
          );
        },
      },
    };
    runInNewContext(readFileSync("dist/main.js", "utf8"), {
      figma,
      __html__: ui,
      console,
      setTimeout,
      clearTimeout,
    });
    await page.exposeFunction(
      "sendToPlugin",
      async (envelope: {
        pluginId: string;
        pluginMessage: { type: string };
      }) => {
        assert.equal(
          envelope.pluginId,
          JSON.parse(readFileSync("manifest.json", "utf8")).id,
        );
        incoming.push(envelope.pluginMessage.type);
        await figma.ui.onmessage!(envelope.pluginMessage);
      },
    );
    await page.setContent(
      '<script>addEventListener("message", e => { if(e.data?.pluginMessage) window.sendToPlugin(e.data); });</script><iframe id="plugin" style="position:fixed;top:0;left:0;width:1000px;height:850px"></iframe>',
    );
    await page.locator("#plugin").evaluate((element, html) => {
      (element as HTMLIFrameElement).srcdoc = html;
    }, ui);
    const frame = page.frameLocator("#plugin");
    await frame
      .getByText(`Connected to Figma · Build ${BUILD_ID}`, { exact: true })
      .waitFor({ state: "attached" });
    await frame.getByRole("button", { name: "Analyze Selection" }).click();
    await frame
      .getByText("Ready to preview and export.", { exact: true })
      .waitFor();
    await frame.getByText("Analysis 100%", { exact: true }).waitFor();
    await Promise.all(pending);
    assert.equal(await frame.locator("#source-view").count(), 0);
    assert.deepEqual(incoming, ["ping", "analyze"]);
    assert.ok(nodeChanged, "analysis subscribes to page changes");
    await frame.locator("#width").selectOption("1920px");
    await frame.locator("#canvas-zoom").selectOption("2");
    const previewBody = frame.frameLocator("#frame").locator("body");
    await previewBody.evaluate(() => window.scrollTo(0, 1100));
    await frame.locator("#canvas-viewport").evaluate((element) => {
      element.scrollLeft = 300;
    });
    await expect
      .poll(() => previewBody.evaluate(() => window.scrollY))
      .toBe(1100);
    sourcePage.selection = [];
    shape.width = 200;
    nodeChanged!();
    nodeChanged!();
    await expect(frame.frameLocator("#frame").locator(".card")).toHaveCSS(
      "width",
      "200px",
    );
    await expect(frame.locator("#sync-status")).toContainText(
      "updated from Figma",
    );
    await expect
      .poll(() => previewBody.evaluate(() => window.scrollY))
      .toBe(1100);
    await expect(frame.locator("#canvas-zoom")).toHaveValue("2");
    assert.equal(
      await frame
        .locator("#canvas-viewport")
        .evaluate((element) => element.scrollLeft),
      300,
    );
    await frame.locator("#edit-mode").uncheck();
    await previewBody.evaluate(() => window.scrollTo(0, 1500));
    await expect
      .poll(() => previewBody.evaluate(() => window.scrollY))
      .toBe(1500);
    await frame.locator("#live-sync").uncheck();
    shape.width = 160;
    nodeChanged!();
    await new Promise((resolve) => setTimeout(resolve, 800));
    await expect(frame.frameLocator("#frame").locator(".card")).toHaveCSS(
      "width",
      "200px",
    );
    await frame.locator("#live-sync").check();
    await expect(frame.frameLocator("#frame").locator(".card")).toHaveCSS(
      "width",
      "160px",
    );
    await expect
      .poll(() => previewBody.evaluate(() => window.scrollY))
      .toBe(1500);
    await frame.locator("#edit-mode").check();
    await frame.locator("#width").selectOption("100%");
    await frame.locator("#canvas-zoom").selectOption("fit");
    await frame.getByRole("button", { name: "Project", exact: true }).click();
    shape.height = 80;
    sourcePage.selection = [shape];
    await frame
      .getByRole("button", { name: "Prepare Figma layout", exact: true })
      .click();
    await frame
      .locator("#prepare-status")
      .filter({ hasText: "No auto-layout frames needed conversion." })
      .waitFor();
    assert.equal(incoming.at(-1), "prepare-layout");
    sourcePage.selection = [];
    await frame.locator("#warning-count").click();
    await frame.locator("#fix-warnings").click();
    await frame
      .locator("#warning-action-status")
      .filter({ hasText: "Re-imported original frames." })
      .waitFor();
    assert.equal(incoming.at(-1), "fix-warnings");
    assert.equal(await frame.locator("#pages option").count(), 1);
    assert.equal(await frame.locator("#pages option").innerText(), "Card");
    assert.equal(
      sourcePage.selection.length,
      0,
      "repair must not change current Figma selection",
    );
    await frame.locator("#warning-close").click();
    sourcePage.selection = [shape];

    await frame
      .getByRole("button", { name: "Import selection", exact: true })
      .click();
    await expect(frame.locator("#status")).toContainText(
      "Figma layers imported.",
    );
    assert.ok(outgoing.includes("import-result"));
    assert.equal(await frame.locator("#edit-layer option").count(), 3);
    sourcePage.selection = [];
    await frame.getByRole("button", { name: "Layers", exact: true }).click();
    await frame.locator("#edit-layer").selectOption({ index: 2 });
    await expect(frame.locator("#source-selection-status")).toContainText(
      "1 matching Figma layer(s) selected.",
    );
    assert.equal(
      sourcePage.selection[0]?.id,
      "shape",
      "imported layer selects original source",
    );
    sourcePage.selection = [];
    await frame
      .frameLocator("#frame")
      .locator(".card")
      .click({ position: { x: 5, y: 5 } });
    await expect.poll(() => sourcePage.selection[0]?.id).toBe("shape");
    await frame.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(
      () =>
        (
          (
            document.getElementById("plugin") as HTMLIFrameElement
          ).contentDocument!.getElementById("edit-layer") as HTMLSelectElement
        ).options.length === 2,
    );
    await frame.getByRole("button", { name: "Project", exact: true }).click();
    await frame
      .locator("#figma-selection-card")
      .dragTo(frame.frameLocator("#frame").locator("body > :first-child"), {
        targetPosition: { x: 60, y: 40 },
      });
    await page.waitForFunction(
      () =>
        (
          (
            document.getElementById("plugin") as HTMLIFrameElement
          ).contentDocument!.getElementById("edit-layer") as HTMLSelectElement
        ).options.length === 3,
    );
    const imported = frame.frameLocator("#frame").locator('[class^="import-"]');
    await imported.waitFor();
    assert.equal(
      await imported.evaluate((element) => getComputedStyle(element).left),
      "60px",
    );
    assert.equal(
      await imported.evaluate((element) => getComputedStyle(element).top),
      "40px",
    );
    await frame.locator("#canvas-zoom").selectOption("0.5");
    const cardBox = await frame.locator("#figma-selection-card").boundingBox();
    const rootBox = await frame
      .frameLocator("#frame")
      .locator("body > :first-child")
      .evaluate((element) => ({
        x: element.getBoundingClientRect().left,
        y: element.getBoundingClientRect().top,
      }));
    const previewBox = await frame.locator("#frame").boundingBox();
    assert.ok(cardBox && previewBox);
    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      previewBox.x + (rootBox.x + 60) * 0.5,
      previewBox.y + (rootBox.y + 40) * 0.5,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (
          (
            document.getElementById("plugin") as HTMLIFrameElement
          ).contentDocument!.getElementById("edit-layer") as HTMLSelectElement
        ).options.length === 4,
    );
    const zoomImported = frame
      .frameLocator("#frame")
      .locator('[class^="import-3-"]');
    await zoomImported.waitFor();
    assert.equal(
      await zoomImported.evaluate((element) => getComputedStyle(element).left),
      "60px",
    );
    assert.equal(
      await zoomImported.evaluate((element) => getComputedStyle(element).top),
      "40px",
    );
    await frame.locator("#window-resize").focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sizes.at(-1)?.[0], 980);
    await frame.locator("#window-resize").scrollIntoViewIfNeeded();
    const grip = await frame.locator("#window-resize").boundingBox();
    assert.ok(grip);
    await page.mouse.move(grip.x + 10, grip.y + 10);
    await page.mouse.down();
    await page.mouse.move(grip.x - 90, grip.y - 90, { steps: 4 });
    assert.equal(sizes.length, 1, "Host must not resize during dragging");
    await page.mouse.up();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sizes.at(-1)?.[0], 900);
    assert.equal(sizes.length, 2, "One resize on release");
    await page.mouse.move(grip.x - 60, grip.y - 60);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sizes.length, 2, "No resize after release");
    await figma.ui.onmessage!({
      type: "resize-window",
      width: 0,
      height: 99999,
    });
    assert.deepEqual(sizes.at(-1), [640, 1600]);
    const count = sizes.length;
    await figma.ui.onmessage!({
      type: "resize-window",
      width: NaN,
      height: 700,
    });
    assert.equal(sizes.length, count);
    assert.ok(outgoing.includes("progress"));
    assert.ok(outgoing.includes("result"));
    assert.ok(!outgoing.includes("error"));
    console.log(
      "Built UI ↔ built plugin round trip passed through a separate host iframe: ping, acknowledgement, analysis, progress, validated result. Host document API is mocked.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
