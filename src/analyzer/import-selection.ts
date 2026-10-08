import type { ExportWarning } from "../diagnostics/warnings";
import { Analyzer } from "./node-analyzer";
import type { Asset, NodeModel } from "../ir/types";
export interface ImportedSelection {
  nodes: NodeModel[];
  assets: Asset[];
  fonts: string[];
  warnings: string[];
  diagnostics?: ExportWarning[];
  exportNotes?: string[];
}
export async function importSelection(
  ids: string[],
  preserveGeometry = true,
): Promise<ImportedSelection> {
  const selected = new Set(ids);
  const roots: SceneNode[] = [];
  for (const id of selected) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !("visible" in node) || !node.visible) continue;
    let parent = node.parent,
      nested = false;
    while (parent) {
      if (selected.has(parent.id)) nested = true;
      parent = parent.parent;
    }
    if (!nested) roots.push(node as SceneNode);
  }
  if (!roots.length) throw new Error("Select visible layers in Figma first.");
  const analyzer = new Analyzer(),
    nodes: NodeModel[] = [];
  analyzer.preserveGeometry = preserveGeometry;
  for (const root of roots) {
    const node = await analyzer.node(root);
    node.placement = {
      x: root.absoluteTransform[0][2],
      y: root.absoluteTransform[1][2],
    };
    nodes.push(node);
  }
  return {
    nodes,
    assets: analyzer.assets.assets,
    fonts: [...analyzer.fonts],
    warnings: analyzer.warnings,
    diagnostics: analyzer.diagnostics,
    exportNotes: analyzer.exportNotes,
  };
}
