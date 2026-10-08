import { sourceGeometry } from "./source-geometry";
import {
  describeWarning,
  canRenderLeaf,
  IMAGE_EXPORT_KEY,
  type ExportWarning,
} from "../diagnostics/warnings";
import type { NodeModel, CoordinateReference } from "../ir/types";
import { isHierarchySquare, recordPlacement } from "./hierarchy-reference";
import { Names } from "../utils/naming";
import { AssetManager } from "../assets/asset-manager";
import { layout } from "./layout-analyzer";
import { appearance, typography } from "./style-analyzer";
import { interaction } from "./interaction-analyzer";
import { assetStyle } from "../assets/asset-style";
export class Analyzer {
  preserveGeometry = false;
  names = new Names();
  assets = new AssetManager();
  warnings: string[] = [];
  diagnostics: ExportWarning[] = [];
  exportNotes: string[] = [];
  fonts = new Set<string>();
  count = 0;
  coordinateRoot?: SceneNode;
  coordinateReference?: CoordinateReference;
  constructor(
    private progress: (count: number, node: SceneNode) => void = () => {},
    private activity: (node: SceneNode) => void = () => {},
  ) {}
  async node(node: SceneNode): Promise<NodeModel> {
    const warnings: string[] = [];
    const paintWarnings: string[] = [];
    const ir: NodeModel = {
      id: node.id,
      sourceId: node.id,
      name: node.name,
      className: this.names.get(node.name),
      tag: "div",
      children: [],
      style: {},
      width: node.width,
      height: node.height,
      layout: "free",
      responsive: false,
    };
    this.count++;
    this.activity(node);
    try {
      if (this.coordinateRoot && this.coordinateReference)
        recordPlacement(
          this.coordinateRoot,
          node,
          ir,
          this.coordinateReference,
        );
      layout(node, ir);
      if (node.getPluginData?.(IMAGE_EXPORT_KEY) === "png") {
        if (canRenderLeaf(node)) {
          ir.asset = await this.assets.export(node, "PNG");
          ir.tag = "img";
          ir.style = assetStyle(ir.style);
          ir.interaction = interaction(node, warnings);
          this.exportNotes.push(
            node.name +
              ": exported as a Figma-rendered image; source remains editable in Figma, exported paint is not editable HTML.",
          );
          this.warnings.push(...warnings);
          this.diagnostics.push(
            ...warnings.map((message) => describeWarning(message, node.id)),
          );
          if (this.preserveGeometry) sourceGeometry(node, ir);
          this.progress(this.count, node);
          return ir;
        }
        warnings.push(
          node.name +
            ": image fallback no longer fits this changed layer; normal analysis restored. Review its appearance.",
        );
      }
      appearance(node, ir.style, paintWarnings);
      warnings.push(...paintWarnings);
      const semantic = node.name
        .toLowerCase()
        .match(
          /^(header|nav|main|footer|section|article|aside|h[1-6]|button|ul|ol|li)(?:\b|:)/,
        )?.[1];
      ir.tag = semantic ?? (/^hero\b/i.test(node.name) ? "section" : "div");
      ir.interaction = interaction(node, warnings);
      if (
        node.type === "COMPONENT" ||
        node.type === "INSTANCE" ||
        node.type === "COMPONENT_SET"
      ) {
        ir.component = node.type;
        if (node.type === "COMPONENT_SET")
          warnings.push(
            `${node.name}: component set exports visible variants as static children.`,
          );
      }
      if (node.type === "TEXT") {
        ir.text = node.characters;
        ir.tag = semantic ?? "p";
        typography(node, ir.style, this.fonts, warnings);
      } else if (
        ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"].includes(
          node.type,
        ) ||
        (node.type === "GROUP" &&
          !node.findAll().some(isHierarchySquare) &&
          node.findAll().length > 0 &&
          node
            .findAll()
            .every(
              (n) =>
                [
                  "GROUP",
                  "VECTOR",
                  "BOOLEAN_OPERATION",
                  "STAR",
                  "POLYGON",
                  "LINE",
                  "RECTANGLE",
                  "ELLIPSE",
                ].includes(n.type) &&
                !(
                  "fills" in n &&
                  Array.isArray(n.fills) &&
                  n.fills.some((p: Paint) => p.type === "IMAGE")
                ),
            ))
      ) {
        ir.asset = await this.assets.export(node, "SVG");
        ir.tag = "img";
        ir.style = assetStyle(ir.style);
      } else {
        const image =
          "fills" in node &&
          Array.isArray(node.fills) &&
          node.fills.some(
            (p: Paint) => p.type === "IMAGE" && p.visible !== false,
          );
        if (image && !("children" in node)) {
          ir.asset = await this.assets.export(node, "PNG");
          ir.tag = "img";
          ir.style = assetStyle(ir.style);
        } else {
          if (image)
            warnings.push(
              `${node.name}: image fill on a container is unsupported; children remain editable.`,
            );
          if ("children" in node) {
            const visible = node.children.filter(
              (c) => c.visible && !isHierarchySquare(c),
            );
            for (const child of visible)
              ir.children.push(await this.node(child));
            if (ir.layout === "free" && visible.length) {
              ir.style.position = "relative";
              ir.style.height = `${node.height}px`;
              for (let i = 0; i < visible.length; i++) {
                const child = visible[i],
                  s = ir.children[i].style;
                s.position = "absolute";
                s.left = `${child.x}px`;
                s.top = `${child.y}px`;
                if (
                  "constraints" in child &&
                  child.constraints.horizontal === "STRETCH"
                ) {
                  s.right = `${node.width - child.x - child.width}px`;
                  s.width = "auto";
                }
              }
              if (this.preserveGeometry)
                this.exportNotes.push(
                  node.name +
                    ": measured desktop positions preserved intentionally. Responsive reflow remains a separate edit.",
                );
              else
                warnings.push(
                  node.name +
                    ": freeform coordinates retained; responsive reflow requires Auto Layout.",
                );
            } else {
              visible.forEach((child, i) => {
                if (
                  "layoutPositioning" in child &&
                  child.layoutPositioning === "ABSOLUTE"
                ) {
                  ir.style.position = "relative";
                  Object.assign(ir.children[i].style, {
                    position: "absolute",
                    left: `${child.x}px`,
                    top: `${child.y}px`,
                  });
                }
              });
              ir.responsive = true;
            }
          } else if (!["RECTANGLE", "ELLIPSE"].includes(node.type)) {
            ir.asset = await this.assets.export(node, "PNG");
            ir.tag = "img";
            ir.style = assetStyle(ir.style);
            warnings.push(`${node.name}: ${node.type} rasterized as fallback.`);
          }
        }
      }
      if ("isMask" in node && node.isMask)
        warnings.push(`${node.name}: mask semantics are unsupported.`);
      if (
        "boundVariables" in node &&
        Object.keys(node.boundVariables ?? {}).length
      )
        warnings.push(
          `${node.name}: variable values use the currently resolved mode.`,
        );
    } catch (error) {
      warnings.push(`${node.name}: ${String(error)}; attempted PNG fallback.`);
      try {
        ir.asset = await this.assets.export(node, "PNG");
        ir.tag = "img";
        ir.children = [];
        ir.style = assetStyle(ir.style);
      } catch (fallback) {
        warnings.push(`${node.name}: fallback failed: ${String(fallback)}`);
      }
    }
    if (ir.asset && paintWarnings.length) {
      for (let i = warnings.length - 1; i >= 0; i--)
        if (paintWarnings.includes(warnings[i])) warnings.splice(i, 1);
      this.exportNotes.push(
        node.name +
          ": appearance is rendered by Figma in the exported " +
          (ir.asset.endsWith(".svg") ? "SVG" : "PNG") +
          "; CSS paint approximation is not used.",
      );
    }
    if (this.preserveGeometry) sourceGeometry(node, ir);
    this.warnings.push(...warnings);
    this.diagnostics.push(
      ...warnings.map((message) => {
        const diagnostic = describeWarning(message, node.id);
        if (
          !ir.asset &&
          canRenderLeaf(node) &&
          /gradient geometry|fill is not translated/.test(message)
        )
          diagnostic.fix = "image";
        return diagnostic;
      }),
    );
    this.progress(this.count, node);
    return ir;
  }
}
