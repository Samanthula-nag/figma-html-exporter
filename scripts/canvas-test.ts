import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildProject } from "../src/exporter/project-builder";
import { BUILD_ID } from "../src/plugin/version";
import type { DocumentModel } from "../src/ir/types";
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(resolve("dist/ui.html")).href);
    const doc: DocumentModel = {
      source: "Canvas test",
      preserveGeometry: true,
      assets: [],
      fonts: ["Inter"],
      warnings: [],
      pages: [
        {
          id: "root",
          name: "Canvas",
          path: "index.html",
          root: {
            id: "root",
            name: "Canvas",
            className: "canvas",
            tag: "div",
            layout: "free",
            responsive: false,
            width: 600,
            height: 800,
            style: { position: "relative", width: "600px", height: "800px" },
            children: [
              {
                id: "title",
                name: "Title",
                className: "title",
                tag: "p",
                text: "Editable text",
                children: [],
                width: 200,
                height: 80,
                layout: "free",
                responsive: false,
                style: {
                  position: "absolute",
                  left: "100px",
                  top: "150px",
                  width: "200px",
                  height: "80px",
                  "font-size": "24px",
                },
              },
              {
                id: "box",
                name: "Box",
                className: "box",
                tag: "div",
                children: [],
                width: 150,
                height: 80,
                layout: "free",
                responsive: false,
                style: {
                  position: "absolute",
                  left: "100px",
                  top: "300px",
                  width: "150px",
                  height: "80px",
                  background: "#abcdef",
                },
              },
            ],
          },
        },
      ],
    };
    doc.warnings = [
      "Box: gradient geometry is approximated in CSS.",
      "Font Inter: binary is not exposed by the Plugin API",
    ];
    doc.diagnostics = [
      {
        message: doc.warnings[0],
        nodeId: "box",
        fix: "image",
        advice: "Use an image fallback for this shape.",
      },
    ];
    const result = buildProject(doc);
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
    await page.getByRole("button", { name: "Show 2 export warnings" }).click();
    await expect(page.locator("#warning-list li")).toHaveCount(2);
    await expect(page.locator("#warning-list")).toContainText(
      "licensed web font",
    );
    await expect(page.locator("#fix-warnings")).toBeEnabled();
    await page.locator("#warning-images").check();
    await expect(page.locator("#fix-warnings")).toBeEnabled();
    await page.evaluate(() => {
      (window as any).warningRequests = [];
      window.addEventListener("message", (e) => {
        if (e.data?.pluginMessage?.type === "fix-warnings")
          (window as any).warningRequests.push(e.data.pluginMessage);
      });
    });
    await page.locator("#fix-warnings").click();
    await page.waitForFunction(
      () => (window as any).warningRequests.length === 1,
    );
    expect(
      await page.evaluate(
        () => (window as any).warningRequests[0].includeImages,
      ),
    ).toBe(true);
    await page.evaluate(() =>
      window.postMessage(
        {
          pluginMessage: {
            type: "warning-action",
            message: "Prepared 1 source layer. Analyze again.",
          },
        },
        "*",
      ),
    );
    await expect(page.locator("#warning-action-status")).toContainText(
      "Analyze again",
    );
    await page
      .locator("#warning-font-file")
      .setInputFiles("C:/Windows/Fonts/arial.ttf");
    await expect(page.locator("#warning-font-status")).toContainText(
      "Font embedded:",
    );
    await expect(page.locator("#warning-list li")).toHaveCount(1);
    await page.locator("#warning-close").click();
    await page.locator("#edit-mode").check();
    await page.locator("#canvas-focus").click();
    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(page.locator("#frame")).toHaveCSS("width", "600px");
    await page.waitForFunction(() => {
      const frame = document.getElementById("frame")!;
      return (
        frame.getBoundingClientRect().width <=
        document.getElementById("canvas-viewport")!.clientWidth + 1
      );
    });
    await page.setViewportSize({ width: 1400, height: 1000 });
    const frame = page.frameLocator("#frame");
    const title = frame.locator(".title");
    await title.click();
    await page.keyboard.press("Control+d");
    await expect(frame.locator("p")).toHaveCount(2);
    await page.locator("#edit-undo").click();
    await expect(frame.locator("p")).toHaveCount(1);
    await title.click();
    await page.locator("#edit-front").click();
    await expect(title).toHaveCSS("z-index", "1");
    await page.locator("#edit-back").click();
    await expect(title).toHaveCSS("z-index", "0");
    const handle = frame.getByTitle(
      "Drag to rotate; Shift snaps to 15 degrees",
    );
    await expect(handle).toBeVisible();
    const rect = await title.boundingBox(),
      grip = await handle.boundingBox();
    if (!rect || !grip) throw Error("missing bounds");
    await page.mouse.move(grip.x + 9, grip.y + 9);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(rect.x + rect.width + 30, rect.y + rect.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect(title).toHaveCSS("rotate", "90deg");
    await page.locator("#edit-undo").click();
    await expect(title).toHaveCSS("rotate", "none");
    const resize = await frame
      .getByTitle("Drag to resize", { exact: true })
      .boundingBox();
    if (!resize) throw Error("missing resize");
    await page.mouse.move(resize.x + 9, resize.y + 9);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(resize.x + 59, resize.y + 14, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect(title).toHaveCSS("width", "250px");
    await expect(title).toHaveCSS("height", "100px");
    await page.locator("#edit-undo").click();
    await expect(title).toHaveCSS("width", "200px");
    await page.locator("#canvas-focus").click();
    await page.locator("#code-open").click();
    await page.locator("#code-add-js").click();
    await page
      .locator("#code-content")
      .fill("document.body.dataset.edited = 'yes';");
    await page.locator("#code-close").click();
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    await (await download).saveAs("test-output/canvas-edited.zip");
    expect(errors).toEqual([]);
    console.log(
      "Canvas interactions passed: duplicate/undo, stacking, direct rotation/snap/undo, proportional resize.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
