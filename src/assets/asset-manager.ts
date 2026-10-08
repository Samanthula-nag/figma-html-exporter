import type { Asset } from "../ir/types";
import { Names } from "../utils/naming";
import { withTimeout } from "../utils/timeout";
export class AssetManager {
  assets: Asset[] = [];
  private names = new Names();
  async export(node: SceneNode, format: "SVG" | "PNG"): Promise<string> {
    const existing = this.assets.find((a) => a.sourceId === node.id);
    if (existing) return existing.path;
    if (!("exportAsync" in node)) throw new Error("Node cannot be exported");
    const bytes = await withTimeout(
      node.exportAsync(
        format === "SVG"
          ? { format: "SVG" }
          : { format: "PNG", constraint: { type: "SCALE", value: 2 } },
      ),
      45000,
      `Exporting ${node.name}`,
    );
    const duplicate = this.assets.find(
      (a) =>
        a.path.endsWith(format.toLowerCase()) &&
        a.bytes.length === bytes.length &&
        a.bytes.every((b, i) => b === bytes[i]),
    );
    const path =
      duplicate?.path ??
      `assets/${format === "SVG" ? (node.width <= 64 && node.height <= 64 ? "icons" : "svg") : "images"}/${this.names.get(node.name)}.${format.toLowerCase()}`;
    this.assets.push({ path, bytes, sourceId: node.id });
    return path;
  }
}
