import type { DocumentModel } from "../ir/types";
import { walk } from "../generators/html";
export function responsive(doc: DocumentModel): string {
  const rules: string[] = [
    "/* Reflow derives from Auto Layout; freeform compositions retain their coordinates. */",
  ];
  for (const page of doc.pages)
    for (const n of walk(page.root)) {
      if (n.responsive) rules.push(`.${n.className} { max-width: 100%; }`);
      if (
        n.layout === "row" &&
        n.children.length > 1 &&
        !n.style["flex-wrap"]
      ) {
        const threshold = Math.ceil(
          n.children.reduce((total, c) => total + c.width, 0) +
            (parseFloat(n.style.gap) || 0) * (n.children.length - 1) +
            32,
        );
        rules.push(
          `@media (max-width: ${threshold}px) {\n  .${n.className} { flex-wrap: wrap; }\n  .${n.className} > * { max-width: 100%; }\n}`,
        );
      }
    }
  if (doc.autoResponsive) {
    rules.push(
      "/* Automatic responsive reflow. Review complex overlapping compositions. */",
    );
    for (const page of doc.pages) {
      const nodes = walk(page.root);
      rules.push(`.${page.root.className} { width: 100%; }`);
      const compact = nodes.map((n) => {
        const declarations = [
          "min-width: 0",
          "max-width: 100%",
          "box-sizing: border-box",
        ];
        if (n.style.position === "absolute" || n.style.position === "fixed")
          declarations.push("position: relative", "inset: auto");
        if (n.style.translate) declarations.push("translate: none");
        if (n.text !== undefined)
          declarations.push(
            "white-space: pre-wrap",
            "overflow-wrap: anywhere",
            "height: auto",
            "min-height: 0",
          );
        if (n.asset) declarations.push("height: auto", "object-fit: contain");
        if (n.children.length) {
          declarations.push("width: 100%", "height: auto", "min-height: 0");
          if (n.layout === "free")
            declarations.push(
              "display: flex",
              "flex-direction: column",
              "gap: 16px",
            );
          if (n.layout === "row") declarations.push("flex-wrap: wrap");
          if (n.layout === "grid")
            declarations.push(
              "grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            );
        }
        if (parseFloat(n.style["font-size"]) > 32)
          declarations.push(
            `font-size: clamp(24px, 5vw, ${parseFloat(n.style["font-size"])}px)`,
          );
        return `  .${n.className} { ${declarations.join("; ")}; }`;
      });
      const breakpoint = Math.max(1024, Math.round(page.root.width) - 1);
      rules.push(
        `@media (max-width: ${breakpoint}px) {\n${compact.join("\n")}\n}`,
      );
      const rows = nodes
        .filter((n) => n.layout === "row")
        .map(
          (n) =>
            `  .${n.className} { flex-direction: column; align-items: stretch; }`,
        );
      if (rows.length)
        rules.push(`@media (max-width: 600px) {\n${rows.join("\n")}\n}`);
    }
  }
  return rules.join("\n\n") + "\n";
}
