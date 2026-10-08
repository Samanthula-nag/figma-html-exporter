import type { DocumentModel, WebFont } from "../ir/types";
import { walk } from "../generators/html";
export function fontVariants(doc: DocumentModel, family: string) {
  const variants = new Map<
    string,
    { weight: string; style: "normal" | "italic" }
  >();
  for (const node of doc.pages.flatMap((page) => walk(page.root))) {
    if (node.text === undefined) continue;
    const raw = (node.style["font-family"] ?? "")
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    if (raw !== family) continue;
    const variant = {
      weight: node.style["font-weight"] || "400",
      style:
        node.style["font-style"] === "italic"
          ? ("italic" as const)
          : ("normal" as const),
    };
    variants.set(variant.weight + ":" + variant.style, variant);
  }
  return variants.size
    ? [...variants.values()]
    : [{ weight: "400", style: "normal" as const }];
}
export function applyWebFonts(doc: DocumentModel, fonts: WebFont[]) {
  doc.webFonts = fonts.filter((font) => doc.fonts.includes(font.family));
  doc.warnings = doc.warnings.filter(
    (warning) =>
      !doc.fonts.some(
        (family) =>
          warning.startsWith("Font " + family + ": binary is not exposed") &&
          fontVariants(doc, family).every((variant) =>
            doc.webFonts!.some(
              (font) =>
                font.family === family &&
                font.weight === variant.weight &&
                font.style === variant.style,
            ),
          ),
      ),
  );
}
export function webFontCss(fonts: WebFont[] = []) {
  return fonts
    .filter(
      (font) =>
        /^data:font\/(woff2?|ttf);base64,[A-Za-z0-9+/=]+$/.test(font.dataUrl) &&
        /^[1-9]00$/.test(font.weight) &&
        ["normal", "italic"].includes(font.style),
    )
    .map(
      (font) =>
        '@font-face { font-family: "' +
        font.family.replace(
          /[^a-zA-Z0-9 _-]/g,
          (char) => "\\" + char.charCodeAt(0).toString(16) + " ",
        ) +
        '"; font-weight: ' +
        font.weight +
        "; font-style: " +
        font.style +
        '; font-display: swap; src: url("' +
        font.dataUrl +
        '"); }',
    )
    .join("\n");
}
