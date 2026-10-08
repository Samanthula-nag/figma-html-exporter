import type { DocumentModel, Files } from "../ir/types";
import { walk } from "../generators/html";
import { validateHtml } from "./html-validator";
import { validateCss } from "./css-validator";
export function validate(doc: DocumentModel, files: Files): string[] {
  const errors: string[] = [],
    classes = new Set<string>(),
    ids = new Set<string>();
  for (const page of doc.pages)
    for (const node of walk(page.root)) {
      if (ids.has(node.id)) errors.push(`Duplicate node ID: ${node.id}`);
      ids.add(node.id);
      if (classes.has(node.className))
        errors.push(`Conflicting generated class: ${node.className}`);
      classes.add(node.className);
      if (node.asset && !files[node.asset])
        errors.push(`Missing asset: ${node.asset}`);
      for (const [key, value] of Object.entries(node.style))
        if (!/^[a-z-]+$/.test(key) || /[{}<>]|NaN|Infinity/.test(value))
          errors.push(`Invalid CSS on ${node.name}: ${key}`);
    }
  for (const [path, data] of Object.entries(files)) {
    if (!data.length) errors.push(`Empty file: ${path}`);
    if (typeof data === "string" && path.endsWith(".css"))
      errors.push(...validateCss(data).map((e) => `${path}: ${e}`));
    if (path.endsWith(".html") && typeof data === "string") {
      errors.push(...validateHtml(data).map((e) => `${path}: ${e}`));
      for (const match of data.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const ref = match[1];
        if (/^(https?:|mailto:|tel:|#)/.test(ref)) continue;
        const resolved = path.startsWith("pages/")
          ? ref.startsWith("../")
            ? ref.slice(3)
            : `pages/${ref}`
          : ref;
        if (!files[resolved])
          errors.push(`Broken reference in ${path}: ${ref}`);
      }
    }
  }
  return [...new Set(errors)];
}
