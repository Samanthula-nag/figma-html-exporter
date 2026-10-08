import type { NodeModel } from "../ir/types";
/** Use resolved source geometry instead of asking the browser to solve layout again. */
export function sourceGeometry(source: SceneNode, ir: NodeModel) {
  for (const key of [
    "flex",
    "flex-direction",
    "flex-wrap",
    "gap",
    "padding",
    "justify-content",
    "align-items",
    "align-self",
    "justify-self",
    "grid-column",
    "grid-row",
    "grid-template-columns",
    "grid-template-rows",
    "column-gap",
    "row-gap",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
  ])
    delete ir.style[key];
  Object.assign(ir.style, {
    width: source.width + "px",
    height: source.height + "px",
    display: "block",
    position: "relative",
    margin: "0",
    padding: "0",
    "max-width": "none",
  });
  ir.layout = "free";
  ir.responsive = false;
  if (ir.text !== undefined) ir.style["overflow-wrap"] = "normal";
  if ("children" in source)
    for (const child of ir.children) {
      const original = source.children.find((node) => node.id === child.id);
      if (!original) continue;
      const matrix = original.relativeTransform;
      const border = parseFloat(ir.style.border) || 0;
      Object.assign(child.style, {
        position: "absolute",
        left: (matrix?.[0][2] ?? original.x) - border + "px",
        top: (matrix?.[1][2] ?? original.y) - border + "px",
        width: original.width + "px",
        height: original.height + "px",
        "transform-origin": "0 0",
      });
      delete child.style.right;
      delete child.style.bottom;
      if (matrix)
        child.style.transform =
          "matrix(" +
          [matrix[0][0], matrix[1][0], matrix[0][1], matrix[1][1], 0, 0].join(
            ",",
          ) +
          ")";
    }
}
