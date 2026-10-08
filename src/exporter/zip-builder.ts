import { zipSync, strToU8 } from "fflate";
import type { Files } from "../ir/types";
export function zip(files: Files): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) {
    if (path.includes("..") || path.startsWith("/") || path.includes("\\"))
      throw new Error(`Unsafe archive path: ${path}`);
    entries[`website/${path}`] =
      typeof value === "string" ? strToU8(value) : value;
  }
  return zipSync(entries, { level: 6 });
}
