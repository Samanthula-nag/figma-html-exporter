import type { Style } from "../ir/types";
/** Rendered assets already contain paint, stroke, clipping and effects. */
export function assetStyle(style: Style): Style {
  const result = { ...style, height: "auto" };
  for (const key of [
    "background",
    "border",
    "border-radius",
    "box-shadow",
    "opacity",
    "overflow",
    "min-height",
  ])
    delete (result as Style)[key];
  return result;
}
