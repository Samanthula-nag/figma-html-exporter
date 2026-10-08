import type { DocumentModel, Files } from "../ir/types";
import { html, walk } from "../generators/html";
import { css } from "../generators/css";
import { javascript } from "../generators/javascript";
import { responsive } from "../responsive/responsive-generator";
import { validate } from "../validation/export-validator";
export function buildProject(doc: DocumentModel): {
  files: Files;
  errors: string[];
} {
  for (const page of doc.pages)
    for (const node of walk(page.root))
      if (
        node.interaction?.type === "navigate" &&
        !doc.pages.some((p) => p.id === node.interaction!.target)
      ) {
        const warning = `${node.name}: destination is not an exported page; navigation omitted.`;
        if (!doc.warnings.includes(warning)) doc.warnings.push(warning);
      }
  const files: Files = {
    "css/styles.css": css(doc),
    "css/responsive.css": responsive(doc),
  };
  const script = javascript(doc);
  if (script) files["js/script.js"] = script;
  for (const asset of doc.assets) files[asset.path] = asset.bytes;
  for (const page of doc.pages) files[page.path] = html(page, doc, !!script);
  if (doc.pages.some((page) => page.reference))
    files["design-map.json"] =
      JSON.stringify(
        {
          pages: doc.pages.map((page) => ({
            name: page.name,
            path: page.path,
            reference: page.reference ?? null,
            layers: walk(page.root).map((node) => ({
              id: node.id,
              name: node.name,
              position: node.placement,
              width: node.width,
              height: node.height,
            })),
          })),
        },
        null,
        2,
      ) + "\n";
  files["README.md"] =
    `# Exported website\n\nSource page: ${doc.source}\n\nOpen index.html in a browser, or serve this folder with a static web server. No Figma or framework runtime is required.\n\n## Pages\n${doc.pages.map((p) => `- ${p.name}: ${p.path}`).join("\n")}\n\n## Assets\n${doc.assets.map((a) => `- ${a.sourceId}: ${a.path}`).join("\n") || "None"}\n\n## Fonts to supply under your license\n${doc.fonts.join("\n") || "None"}\n\n## Warnings and unsupported features\n${[...new Set(doc.warnings)].map((w) => `- ${w}`).join("\n") || "None detected"}\n\nResponsive wrapping is inferred from measured Auto Layout children. Review semantics, alternative text, breakpoints and keyboard behavior before publishing. User-supplied font files are embedded in css/styles.css when provided; other fonts must be supplied under your license. Prototype state transitions are not application logic.\n`;
  files["README.md"] +=
    "\n## Coordinate references\n" +
    doc.pages
      .map((page) =>
        page.reference
          ? `- ${page.name}: hierarchy square ${page.reference.markerId}; ${page.reference.width}px reference width. Layer origins relative to the square are recorded in design-map.json. Nested CSS retains parent-local positions; the marker itself is not exported.`
          : `- ${page.name}: frame origin used.`,
      )
      .join("\n") +
    "\n";
  files["README.md"] +=
    "\n## Export notes\n" +
    (doc.exportNotes ?? []).map((note) => "- " + note).join("\n") +
    "\n";
  return { files, errors: validate(doc, files) };
}
