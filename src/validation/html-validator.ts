import { parse } from "parse5";
export function validateHtml(html: string): string[] {
  const errors: string[] = [];
  parse(html, {
    onParseError: (error) =>
      errors.push(`HTML ${error.code} at line ${error.startLine}`),
  });
  const ids = new Set<string>();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    if (ids.has(match[1])) errors.push(`Duplicate HTML ID: ${match[1]}`);
    ids.add(match[1]);
  }
  return errors;
}
