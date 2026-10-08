import { webFontCss } from "../fonts/web-fonts";
import type { DocumentModel } from "../ir/types";
import { walk } from "./html";
export function css(doc: DocumentModel): string {
  const nodes = doc.pages.flatMap((p) => walk(p.root));
  const counts = new Map<string, number>();
  for (const n of nodes)
    for (const [k, v] of Object.entries(n.style))
      if (["color", "background", "gap", "border-radius"].includes(k))
        counts.set(`${k}|${v}`, (counts.get(`${k}|${v}`) ?? 0) + 1);
  const tokens = new Map<string, string>();
  for (const [key, count] of counts)
    if (count >= 3)
      tokens.set(key, `--shared-${key.split("|")[0]}-${tokens.size + 1}`);
  const root = [...tokens]
    .map(([key, name]) => `  ${name}: ${key.slice(key.indexOf("|") + 1)};`)
    .join("\n");
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const declarations = Object.entries(node.style)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([k, v]) =>
          `  ${k}: ${tokens.has(`${k}|${v}`) ? `var(${tokens.get(`${k}|${v}`)})` : v};`,
      )
      .join("\n");
    groups.set(declarations, [
      ...(groups.get(declarations) ?? []),
      `.${node.className}`,
    ]);
  }
  return `${webFontCss(doc.webFonts)}\n* { box-sizing: border-box; }\nbody { margin: 0; }\nh1, h2, h3, h4, h5, h6, p { margin: 0; }\nbutton, a { font: inherit; color: inherit; }\nbutton { cursor: pointer; }\na { text-decoration: none; }\nimg { display: block; max-width: 100%; }\n:focus-visible { outline: 3px solid #2463eb; outline-offset: 3px; }\n${root ? `:root {\n${root}\n}\n` : ""}\n${[...groups].map(([body, selectors]) => `${selectors.join(",\n")} {\n${body}\n}`).join("\n\n")}\n`;
}
