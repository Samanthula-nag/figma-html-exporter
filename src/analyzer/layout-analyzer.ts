import type { NodeModel } from "../ir/types";
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
export function layout(node: SceneNode, ir: NodeModel): void {
  const s = ir.style;
  s["box-sizing"] = "border-box";
  s.width = px(node.width);
  s["min-height"] = px(node.height);
  for (const [property, value] of [
    ["min-width", node.minWidth],
    ["max-width", node.maxWidth],
    ["max-height", node.maxHeight],
  ] as const) {
    if (typeof value === "number") s[property] = px(value);
  }
  if (
    node.parent &&
    "layoutMode" in node.parent &&
    node.parent.layoutMode === "GRID" &&
    "gridColumnSpan" in node
  ) {
    s["grid-column"] =
      `${node.gridColumnAnchorIndex + 1} / span ${node.gridColumnSpan}`;
    s["grid-row"] = `${node.gridRowAnchorIndex + 1} / span ${node.gridRowSpan}`;
    const alignment = {
      MIN: "start",
      MAX: "end",
      CENTER: "center",
      AUTO: "normal",
    };
    s["justify-self"] = alignment[node.gridChildHorizontalAlign];
    s["align-self"] = alignment[node.gridChildVerticalAlign];
  }
  if ("layoutSizingHorizontal" in node) {
    if (node.layoutSizingHorizontal === "FILL") {
      s.width = "100%";
      s["min-width"] = "0";
      if (
        node.parent &&
        "layoutMode" in node.parent &&
        node.parent.layoutMode === "HORIZONTAL"
      ) {
        s.width = "auto";
        s.flex = "1 1 0";
      }
    }
    if (node.layoutSizingHorizontal === "HUG") s.width = "fit-content";
    if (node.layoutSizingVertical === "HUG") delete s["min-height"];
    if (
      node.layoutSizingVertical === "FILL" &&
      node.parent &&
      "layoutMode" in node.parent &&
      node.parent.layoutMode === "VERTICAL"
    )
      s.flex = "1 1 0";
  }
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    ir.layout =
      node.layoutMode === "HORIZONTAL"
        ? "row"
        : node.layoutMode === "GRID"
          ? "grid"
          : "column";
    s.display = ir.layout === "grid" ? "grid" : "flex";
    if (ir.layout !== "grid") s["flex-direction"] = ir.layout;
    s.gap = px(node.itemSpacing);
    s.padding = `${px(node.paddingTop)} ${px(node.paddingRight)} ${px(node.paddingBottom)} ${px(node.paddingLeft)}`;
    const align = {
      MIN: "flex-start",
      MAX: "flex-end",
      CENTER: "center",
      SPACE_BETWEEN: "space-between",
      SPACE_AROUND: "space-around",
      SPACE_EVENLY: "space-evenly",
      BASELINE: "baseline",
    };
    s["justify-content"] = align[node.primaryAxisAlignItems];
    s["align-items"] = align[node.counterAxisAlignItems];
    if (node.layoutWrap === "WRAP") s["flex-wrap"] = "wrap";
    if (node.layoutMode === "GRID") {
      const track = (t: GridTrackSize) =>
        t.type === "FIXED"
          ? `${t.value ?? 0}px`
          : t.type === "HUG"
            ? "max-content"
            : `minmax(0, ${t.value ?? 1}fr)`;
      s["grid-template-columns"] = node.gridColumnSizes.map(track).join(" ");
      s["grid-template-rows"] = node.gridRowSizes.map(track).join(" ");
      s["column-gap"] = px(node.gridColumnGap);
      s["row-gap"] = px(node.gridRowGap);
    }
  }
  if ("clipsContent" in node && node.clipsContent) s.overflow = "hidden";
  if ("opacity" in node && node.opacity !== 1) s.opacity = String(node.opacity);
  if ("rotation" in node && node.rotation)
    s.transform = `rotate(${-node.rotation}deg)`;
}
