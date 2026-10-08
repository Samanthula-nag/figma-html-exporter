import type { Files } from "../ir/types";
export function preview(
  files: Files,
  path: string,
): { html: string; urls: string[] } {
  const urls: string[] = [];
  let html = String(files[path]);
  const resolve = (ref: string) =>
    path.startsWith("pages/")
      ? ref.startsWith("../")
        ? ref.slice(3)
        : `pages/${ref}`
      : ref;
  html = html.replace(
    /<link rel="stylesheet" href="([^"]+)">/g,
    (_, ref: string) => `<style>${files[resolve(ref)]}</style>`,
  );
  html = html.replace(/src="([^"]+)"/g, (match, ref: string) => {
    const key = resolve(ref),
      value = files[key];
    if (!(value instanceof Uint8Array)) return match;
    // A sandboxed srcdoc has an opaque origin; parent blob URLs can be blocked.
    let binary = "";
    for (let i = 0; i < value.length; i += 8192)
      binary += String.fromCharCode(...value.subarray(i, i + 8192));
    const url = `data:${key.endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${btoa(binary)}`;
    return `src="${url}"`;
  });
  html = html.replace(/<script[\s\S]*?<\/script>/g, "");
  return { html, urls };
}
