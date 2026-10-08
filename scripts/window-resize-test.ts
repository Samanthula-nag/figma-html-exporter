import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createWindowControls } from "../src/plugin/window-controls";
import { BUILD_ID } from "../src/plugin/version";
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1800, height: 1200 },
      screen: { width: 3000, height: 2000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let position = { x: 200, y: 150 };
    const sizes: number[][] = [],
      moves: number[][] = [];
    const pending: Promise<unknown>[] = [];
    const controls = createWindowControls(
      {
        resize: (width: number, height: number) => {
          sizes.push([width, height]);
          pending.push(
            page.locator("#plugin").evaluate(
              (el, v) => {
                (el as HTMLElement).style.width = v[0] + "px";
                (el as HTMLElement).style.height = v[1] + "px";
              },
              [width, height],
            ),
          );
        },
        reposition: (x: number, y: number) => {
          position = { x, y };
          moves.push([x, y]);
          pending.push(
            page.locator("#plugin").evaluate(
              (el, v) => {
                (el as HTMLElement).style.left = v[0] + "px";
                (el as HTMLElement).style.top = v[1] + "px";
              },
              [x, y],
            ),
          );
        },
        getPosition: () => ({ canvasSpace: position, windowSpace: position }),
        postMessage: () => {},
      } as unknown as UIAPI,
      () => 1,
    );
    await page.exposeFunction("hostMessage", async (message: any) => {
      if (message.type === "ping")
        await page.locator("#plugin").evaluate((el, build) => {
          (el as HTMLIFrameElement).contentWindow!.postMessage(
            {
              pluginMessage: {
                type: "pong",
                build,
                busy: false,
                windowControls: { resize: true, move: true },
              },
            },
            "*",
          );
        }, BUILD_ID);
      else controls.handle(message);
    });
    await page.setContent(
      '<script>addEventListener("message",e=>{if(e.data?.pluginMessage)window.hostMessage(e.data.pluginMessage)})</script><iframe id="plugin" style="position:absolute;left:200px;top:150px;width:900px;height:650px;border:0"></iframe>',
    );
    await page
      .locator("#plugin")
      .evaluate(
        (el, html) => ((el as HTMLIFrameElement).srcdoc = html),
        readFileSync("dist/ui.html", "utf8"),
      );
    const ui = page.frameLocator("#plugin");
    await expect(ui.locator("#window-move")).toBeVisible();
    const dirs = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
    for (const dir of dirs) {
      await Promise.all(pending);
      pending.length = 0;
      position = { x: 200, y: 150 };
      sizes.length = 0;
      moves.length = 0;
      await page.locator("#plugin").evaluate((el) => {
        Object.assign((el as HTMLElement).style, {
          left: "200px",
          top: "150px",
          width: "900px",
          height: "650px",
        });
      });
      const handle = ui.locator(`[data-direction="${dir}"]`);
      await expect(handle).toHaveCSS(
        "cursor",
        dir.length === 1
          ? "ew".includes(dir)
            ? "ew-resize"
            : "ns-resize"
          : ["nw", "se"].includes(dir)
            ? "nwse-resize"
            : "nesw-resize",
      );
      const box = await handle.boundingBox();
      if (!box) throw Error("Missing handle");
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      const dx = dir.includes("e") ? 40 : dir.includes("w") ? -40 : 0,
        dy = dir.includes("s") ? 40 : dir.includes("n") ? -40 : 0;
      await page.mouse.move(x, y);
      await expect(handle.locator("span")).toHaveCSS("opacity", "0.85");
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 4 });
      await expect
        .poll(() => sizes.at(-1))
        .toEqual([900 + (dx ? 40 : 0), 650 + (dy ? 40 : 0)]);
      await page.mouse.up();
      await expect(ui.locator("#window-gesture-shield")).toHaveCount(0);
      if (dir.includes("w") || dir.includes("n"))
        await expect
          .poll(() => moves.at(-1))
          .toEqual([
            200 - (dir.includes("w") ? 40 : 0),
            150 - (dir.includes("n") ? 40 : 0),
          ]);
      console.log("Passed live resize", dir);
    }
    // Actual move API dispatch, without resizing the content.
    const move = await ui.locator("#window-move").boundingBox();
    if (!move) throw Error("Missing move");
    const count = sizes.length,
      start = { ...position };
    await page.mouse.move(move.x + move.width / 2, move.y + move.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      move.x + move.width / 2 + 30,
      move.y + move.height / 2 + 20,
      { steps: 3 },
    );
    await expect.poll(() => moves.at(-1)).toEqual([start.x + 30, start.y + 20]);
    await page.mouse.up();
    expect(sizes.length).toBe(count);
    // Cancellation removes capture and its temporary shield.
    const edge = ui.locator('[data-direction="e"]');
    const edgeBox = await edge.boundingBox();
    if (!edgeBox) throw Error("Missing edge");
    await page.mouse.move(edgeBox.x + 2, edgeBox.y + 40);
    await page.mouse.down();
    await expect(ui.locator("#window-gesture-shield")).toHaveCount(1);
    await edge.evaluate((el) =>
      el.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
      ),
    );
    await expect(ui.locator("#window-gesture-shield")).toHaveCount(0);
    await page.mouse.up();
    // Existing content stays interactive.
    await ui.getByRole("button", { name: "Design", exact: true }).click();
    await expect(ui.locator("#edit-fields")).toBeVisible();
    await ui.getByRole("button", { name: "Layers", exact: true }).click();
    await ui.locator("#layer-search").fill("Heading");
    await expect(ui.locator("#layer-search")).toHaveValue("Heading");
    await ui.locator("#canvas-zoom").selectOption("0.5");
    await expect(ui.locator("#canvas-zoom")).toHaveValue("0.5");
    await page
      .locator("#plugin")
      .evaluate((el) =>
        (el as HTMLIFrameElement).contentWindow!.postMessage(
          {
            pluginMessage: {
              type: "pong",
              windowControls: { resize: true, move: false },
            },
          },
          "*",
        ),
      );
    await expect(ui.locator("#window-move")).toBeHidden();
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "All 8 directions, live host resizing, move capability, and existing controls passed (mocked Figma host).",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
