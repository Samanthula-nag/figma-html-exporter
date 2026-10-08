import {
  canRenderLeaf,
  IMAGE_EXPORT_KEY,
  type ExportWarning,
} from "../diagnostics/warnings";
import { withTimeout } from "../utils/timeout";
export async function fixWarnings(
  warnings: ExportWarning[],
  includeImages: boolean,
) {
  const fixes = new Map(
    warnings
      .filter((w) => w.nodeId && w.fix && (w.fix !== "image" || includeImages))
      .map((w) => [w.nodeId!, w.fix!]),
  );
  const ready: { node: SceneNode; fix: "marker" | "image" }[] = [],
    skipped: string[] = [];
  for (const [id, fix] of fixes) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !("visible" in node)) {
      skipped.push(id + ": source layer no longer exists");
      continue;
    }
    let ancestor: BaseNode | null = node;
    let protectedNode = false;
    while (
      ancestor &&
      ancestor.type !== "PAGE" &&
      ancestor.type !== "DOCUMENT"
    ) {
      if (
        ("locked" in ancestor && ancestor.locked) ||
        ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(ancestor.type)
      )
        protectedNode = true;
      ancestor = ancestor.parent;
    }
    if (protectedNode || ancestor?.id !== figma.currentPage.id) {
      skipped.push(node.name + ": locked, component-owned, or on another page");
      continue;
    }
    if (fix === "marker") {
      if (
        node.type !== "FRAME" ||
        node.findAll(
          (n) =>
            n.name
              .trim()
              .toLowerCase()
              .replace(/[ _-]+/g, " ") === "hierarchy square",
        ).length
      ) {
        skipped.push(node.name + ": marker needs manual review");
        continue;
      }
    } else {
      if (
        !canRenderLeaf(node) ||
        node.getPluginData(IMAGE_EXPORT_KEY) === "png" ||
        !("fills" in node) ||
        !Array.isArray(node.fills) ||
        !node.fills.some(
          (paint) =>
            paint.visible !== false && paint.type.startsWith("GRADIENT"),
        )
      ) {
        skipped.push(node.name + ": source changed or already prepared");
        continue;
      }
      try {
        await withTimeout(
          node.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: 2 },
          }),
          45000,
          "Checking image export for " + node.name,
        );
      } catch (error) {
        skipped.push(node.name + ": " + String(error));
        continue;
      }
    }
    ready.push({ node: node as SceneNode, fix });
  }
  if (!ready.length) return { changed: 0, skipped };
  figma.commitUndo();
  try {
    for (const { node, fix } of ready) {
      if (fix === "image") node.setPluginData(IMAGE_EXPORT_KEY, "png");
      else if (node.type === "FRAME") {
        const width = node.width,
          height = node.height;
        const marker = figma.createRectangle();
        marker.name = "hierarchy square";
        marker.resize(15, 15);
        marker.opacity = 0;
        marker.fills = [];
        node.appendChild(marker);
        if (node.layoutMode !== "NONE") marker.layoutPositioning = "ABSOLUTE";
        marker.x = 0;
        marker.y = 0;
        if (
          Math.abs(node.width - width) > 0.05 ||
          Math.abs(node.height - height) > 0.05
        )
          throw new Error(
            "Adding the marker changed " +
              node.name +
              " size; use a manual reference instead.",
          );
      }
    }
  } catch (error) {
    figma.commitUndo();
    figma.triggerUndo();
    throw error;
  }
  figma.commitUndo();
  return { changed: ready.length, skipped };
}
