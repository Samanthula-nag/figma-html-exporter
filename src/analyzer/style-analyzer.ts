import type { Style } from "../ir/types";
export const color = (c: RGB, opacity = 1) =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${opacity})`;
export function appearance(
  node: SceneNode,
  style: Style,
  warnings: string[],
): void {
  if ("fills" in node && Array.isArray(node.fills)) {
    const backgrounds: string[] = [];
    for (const fill of node.fills as Paint[]) {
      if (fill.visible === false || fill.type === "IMAGE") continue;
      if (fill.type === "SOLID")
        backgrounds.push(
          `linear-gradient(${color(fill.color, fill.opacity)}, ${color(fill.color, fill.opacity)})`,
        );
      else if (fill.type === "GRADIENT_LINEAR") {
        const t = fill.gradientTransform;
        const angle = (Math.atan2(t[0][0], -t[0][1]) * 180) / Math.PI;
        backgrounds.push(
          `linear-gradient(${angle}deg, ${fill.gradientStops.map((s) => `${color(s.color, s.color.a * (fill.opacity ?? 1))} ${s.position * 100}%`).join(", ")})`,
        );
        warnings.push(
          `${node.name}: gradient geometry is approximated in CSS.`,
        );
      } else
        warnings.push(`${node.name}: ${fill.type} fill is not translated.`);
    }
    if (backgrounds.length) style.background = backgrounds.reverse().join(", ");
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number")
    style["border-radius"] = `${node.cornerRadius}px`;
  if (node.type === "ELLIPSE") style["border-radius"] = "50%";
  if ("strokes" in node && node.strokes.length) {
    const stroke = node.strokes.find((s) => s.visible !== false);
    if (
      stroke?.type === "SOLID" &&
      "strokeWeight" in node &&
      typeof node.strokeWeight === "number"
    )
      style.border = `${node.strokeWeight}px solid ${color(stroke.color, stroke.opacity)}`;
    if (node.strokeAlign !== "INSIDE")
      warnings.push(
        `${node.name}: stroke alignment approximated by CSS border.`,
      );
  }
  if ("effects" in node) {
    const shadows: string[] = [];
    for (const e of node.effects.filter((e) => e.visible)) {
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        shadows.push(
          `${e.type === "INNER_SHADOW" ? "inset " : ""}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${e.spread ?? 0}px ${color(e.color, e.color.a)}`,
        );
      else warnings.push(`${node.name}: ${e.type} effect is unsupported.`);
    }
    if (shadows.length) style["box-shadow"] = shadows.join(", ");
  }
}
export function typography(
  node: TextNode,
  style: Style,
  fonts: Set<string>,
  warnings: string[],
): void {
  const segments = node.getStyledTextSegments([
    "fontName",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "fills",
    "textCase",
    "textDecoration",
  ]);
  const first = segments[0];
  if (!first) return;
  for (const segment of segments) fonts.add(segment.fontName.family);
  if (segments.length > 1)
    warnings.push(
      `${node.name}: mixed text styles use the first segment's style.`,
    );
  style["font-family"] = `${JSON.stringify(first.fontName.family)}, sans-serif`;
  style["font-size"] = `${first.fontSize}px`;
  style["font-weight"] = String(first.fontWeight);
  style["font-style"] = /italic|oblique/i.test(first.fontName.style)
    ? "italic"
    : "normal";
  style["line-height"] =
    first.lineHeight.unit === "AUTO"
      ? "normal"
      : first.lineHeight.unit === "PIXELS"
        ? `${first.lineHeight.value}px`
        : String(first.lineHeight.value / 100);
  style["letter-spacing"] =
    first.letterSpacing.unit === "PIXELS"
      ? `${first.letterSpacing.value}px`
      : `${first.letterSpacing.value / 100}em`;
  style["text-align"] = node.textAlignHorizontal.toLowerCase();
  style["white-space"] = "pre-wrap";
  style["overflow-wrap"] = "anywhere";
  const fill = first.fills.find(
    (p) => p.type === "SOLID" && p.visible !== false,
  );
  if (fill?.type === "SOLID") style.color = color(fill.color, fill.opacity);
  delete style.background;
  if (first.textDecoration !== "NONE")
    style["text-decoration"] =
      first.textDecoration === "STRIKETHROUGH" ? "line-through" : "underline";
  if (first.textCase === "UPPER" || first.textCase === "LOWER")
    style["text-transform"] =
      first.textCase === "UPPER" ? "uppercase" : "lowercase";
}
