import type { DocumentModel } from "../ir/types";
import { walk } from "./html";
export function javascript(doc: DocumentModel): string | undefined {
  if (
    !doc.pages.some((p) =>
      walk(p.root).some((n) => n.interaction?.type === "back"),
    )
  )
    return;
  return `'use strict';\ndocument.querySelectorAll('[data-history-back]').forEach(function (button) {\n  button.addEventListener('click', function () { if (history.length > 1) history.back(); });\n});\n`;
}
