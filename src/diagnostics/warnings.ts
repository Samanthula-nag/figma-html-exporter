export interface ExportWarning {
  message: string;
  nodeId?: string;
  fix?: "marker" | "image";
  advice: string;
}
export function describeWarning(
  message: string,
  nodeId?: string,
): ExportWarning {
  let advice = "Review this layer in Figma and check the exported result.";
  if (/Font .*binary is not exposed/.test(message))
    advice =
      "Supply a licensed web font in your website. Figma cannot provide the font file automatically.";
  else if (/freeform coordinates/.test(message))
    advice =
      "Desktop positions are retained. Responsive reflow needs a deliberate layout or the plugin's Auto responsive option; changing Figma automatically could move your design.";
  else if (/no valid hierarchy square/.test(message))
    advice =
      "An invisible 15×15 reference square can be added at this frame's origin.";
  else if (/hierarchy square|hierarchy squares|design width/.test(message))
    advice =
      "Check the reference square and frame dimensions manually. The plugin will not resize your design or choose between ambiguous markers.";
  else if (/mixed text styles/.test(message))
    advice =
      "This exporter currently uses the first text style. Split styled runs into separate text layers, or review their formatting manually.";
  else if (
    /gradient geometry|fill is not translated|image fill on a container|effect is unsupported|stroke alignment/.test(
      message,
    )
  )
    advice =
      "Some Figma paint cannot be reproduced with the current CSS exporter. Simple unrotated leaf shapes can use a rendered image; containers, text, effects and strokes extending beyond the layer need review.";
  else if (/variable values/.test(message))
    advice =
      "The current variable mode is exported as fixed values; other modes are not included.";
  else if (/mask/.test(message))
    advice =
      "Review the masked group as a whole. Automatically changing an individual mask can damage the composition.";
  return { message, nodeId, advice };
}
export const IMAGE_EXPORT_KEY = "exporter-visual-fallback";
export function canRenderLeaf(node: SceneNode): boolean {
  return (
    (node.type === "RECTANGLE" || node.type === "ELLIPSE") &&
    !("children" in node) &&
    Math.abs(node.rotation) < 0.001 &&
    !("effects" in node && node.effects.some((effect) => effect.visible)) &&
    !(
      "strokes" in node &&
      node.strokes.some((stroke) => stroke.visible !== false)
    )
  );
}
