import { applyWebFonts } from "../fonts/web-fonts";
import type { WebFont } from "../ir/types";
import type { DocumentModel, NodeModel, Style } from "../ir/types";
import { walk } from "../generators/html";
import type { ImportedSelection } from "../analyzer/import-selection";

export type Edit = { style?: Style; text?: string };
const allowed = new Set([
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "font-size",
  "line-height",
  "letter-spacing",
  "gap",
  "padding",
  "display",
  "flex-direction",
  "flex-wrap",
  "white-space",
  "text-align",
  "translate",
  "color",
  "rotate",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
]);
function clone(doc: DocumentModel): DocumentModel {
  return {
    ...doc,
    warnings: [...doc.warnings],
    pages: JSON.parse(JSON.stringify(doc.pages)),
  };
}

/** Edits live in the IR, so preview and ZIP use the same corrected model. */
export class EditorSession {
  doc: DocumentModel;
  private history: DocumentModel[] = [];
  private future: DocumentModel[] = [];
  private original: DocumentModel;
  private batching = false;
  private importSequence = 0;
  private copySequence = 0;
  constructor(doc: DocumentModel) {
    this.original = clone(doc);
    this.doc = clone(doc);
  }
  get canUndo() {
    return this.history.length > 0;
  }
  addWebFont(font: WebFont) {
    this.remember();
    applyWebFonts(this.doc, [
      ...(this.doc.webFonts ?? []).filter(
        (existing) =>
          existing.family !== font.family ||
          existing.weight !== font.weight ||
          existing.style !== font.style,
      ),
      font,
    ]);
  }
  autoResponsive() {
    if (this.doc.autoResponsive) return;
    this.remember();
    this.doc.autoResponsive = true;
  }
  deleteMany(ids: string[]) {
    const chosen = new Set(ids);
    if (this.doc.pages.some((page) => chosen.has(page.root.id)))
      throw new Error(
        "Keep the page container; select its child layers to delete.",
      );
    if (!ids.some((id) => this.find(id))) return;
    this.remember();
    const prune = (node: NodeModel) => {
      node.children = node.children.filter((child) => !chosen.has(child.id));
      node.children.forEach(prune);
    };
    this.doc.pages.forEach((page) => prune(page.root));
  }
  importInto(
    path: string,
    selection: ImportedSelection,
    x: number,
    y: number,
  ): string[] {
    const page = this.doc.pages.find((page) => page.path === path);
    if (
      !page ||
      !selection.nodes.length ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      throw new Error("Choose an exported page before importing.");
    if (page.root.text !== undefined || page.root.asset)
      throw new Error(
        "Analyze a frame or container before importing layers into it.",
      );
    this.remember();
    const prefix = `import-${++this.importSequence}-`,
      nodes = JSON.parse(JSON.stringify(selection.nodes)) as NodeModel[];
    const assets = new Map(
      selection.assets.map((asset) => [
        asset.path,
        `assets/${prefix}${asset.path.replace(/^assets\//, "")}`,
      ]),
    );
    const originX = Math.min(...nodes.map((node) => node.placement?.x ?? 0)),
      originY = Math.min(...nodes.map((node) => node.placement?.y ?? 0));
    for (const root of nodes) {
      for (const node of walk(root)) {
        node.id = prefix + node.id;
        node.className = prefix + node.className;
        if (node.asset) node.asset = assets.get(node.asset) ?? node.asset;
      }
      if (root.tag === "main") root.tag = "section";
      const left = x + (root.placement?.x ?? originX) - originX,
        top = y + (root.placement?.y ?? originY) - originY;
      Object.assign(root.style, {
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${root.width}px`,
        height: `${root.height}px`,
      });
      delete root.style.right;
      delete root.style.bottom;
    }
    page.root.style.position = "relative";
    page.root.children.push(...nodes);
    this.doc.assets = [
      ...this.doc.assets,
      ...selection.assets.map((asset) => ({
        ...asset,
        path: assets.get(asset.path)!,
      })),
    ];
    this.doc.fonts = [...new Set([...this.doc.fonts, ...selection.fonts])];
    this.doc.warnings = [...this.doc.warnings, ...selection.warnings];
    this.doc.diagnostics = [
      ...(this.doc.diagnostics ?? []),
      ...(selection.diagnostics ?? []),
    ];
    this.doc.exportNotes = [
      ...(this.doc.exportNotes ?? []),
      ...(selection.exportNotes ?? []),
    ];
    return nodes.map((node) => node.id);
  }
  duplicateMany(ids: string[]): string[] {
    const chosen = new Set(ids),
      copies: string[] = [];
    if (this.doc.pages.some((page) => chosen.has(page.root.id)))
      throw new Error(
        "Select child layers to duplicate, not the page container.",
      );
    this.transaction(() => {
      const visit = (parent: NodeModel) => {
        const children: NodeModel[] = [];
        for (const child of parent.children) {
          children.push(child);
          if (!chosen.has(child.id)) {
            visit(child);
            continue;
          }
          const copy = JSON.parse(JSON.stringify(child)) as NodeModel;
          const prefix = "copy-" + ++this.copySequence + "-";
          for (const node of walk(copy)) {
            delete node.sourceId;
            node.id = prefix + node.id;
            node.className = prefix + node.className;
          }
          copy.name += " copy";
          const [x = 0, y = 0] = (copy.style.translate ?? "0 0")
            .split(/\s+/)
            .map(parseFloat);
          copy.style.translate = x + 16 + "px " + (y + 16) + "px";
          children.push(copy);
          copies.push(copy.id);
        }
        parent.children = children;
      };
      this.doc.pages.forEach((page) => visit(page.root));
    });
    return copies;
  }
  arrangeMany(ids: string[], front: boolean) {
    const chosen = new Set(ids);
    this.transaction(() => {
      for (const parent of this.doc.pages.flatMap((page) => walk(page.root))) {
        if (!parent.children.some((child) => chosen.has(child.id))) continue;
        const sorted = [...parent.children].sort(
          (a, b) =>
            (parseFloat(a.style["z-index"]) || 0) -
            (parseFloat(b.style["z-index"]) || 0),
        );
        const selected = sorted.filter((child) => chosen.has(child.id)),
          others = sorted.filter((child) => !chosen.has(child.id));
        (front ? [...others, ...selected] : [...selected, ...others]).forEach(
          (child, index) => {
            child.style["z-index"] = String(index);
            if (!child.style.position || child.style.position === "static")
              child.style.position = "relative";
          },
        );
      }
    });
  }
  get canRedo() {
    return this.future.length > 0;
  }
  find(id: string): NodeModel | undefined {
    return this.doc.pages
      .flatMap((page) => walk(page.root))
      .find((node) => node.id === id);
  }
  private remember() {
    if (this.batching) return;
    this.history.push(clone(this.doc));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }
  applyMany(ids: string[], edit: Edit) {
    this.transaction(() => {
      for (const id of new Set(ids)) this.apply(id, edit);
    });
  }
  resetMany(ids: string[]) {
    this.transaction(() => {
      for (const id of new Set(ids)) this.reset(id);
    });
  }
  moveMany(ids: string[], dx: number, dy: number) {
    const selected = new Set(ids);
    // Moving an ancestor already moves its descendants.
    const roots = ids.filter(
      (id) =>
        !this.doc.pages
          .flatMap((p) => walk(p.root))
          .some(
            (n) =>
              selected.has(n.id) &&
              n.id !== id &&
              walk(n).some((child) => child.id === id),
          ),
    );
    this.transaction(() => {
      for (const id of new Set(roots)) this.move(id, dx, dy);
    });
  }
  private transaction(work: () => void) {
    const before = clone(this.doc),
      history = [...this.history],
      future = [...this.future];
    this.remember();
    this.batching = true;
    try {
      work();
    } catch (error) {
      this.doc = before;
      this.history = history;
      this.future = future;
      throw error;
    } finally {
      this.batching = false;
    }
  }
  apply(id: string, edit: Edit) {
    const node = this.find(id);
    if (!node) throw new Error("Selected layer no longer exists.");
    for (const [key, value] of Object.entries(edit.style ?? {})) {
      if (!allowed.has(key) || /[{};<>]|url\(|NaN|Infinity/i.test(value))
        throw new Error(`Unsupported edit: ${key}`);
    }
    if (edit.text !== undefined && node.text === undefined)
      throw new Error("Text can only be changed on a text layer.");
    this.remember();
    Object.assign(node.style, edit.style);
    if (
      edit.style?.display === "flex" &&
      ["row", "column"].includes(edit.style["flex-direction"])
    ) {
      node.layout = edit.style["flex-direction"] as "row" | "column";
      node.responsive = true;
      for (const child of node.children)
        if (child.style.position === "absolute") {
          for (const key of ["position", "left", "top", "right", "bottom"])
            delete child.style[key];
        }
    }
    if (edit.text !== undefined) node.text = edit.text;
    if (edit.style?.width && /^\d+(\.\d+)?px$/.test(edit.style.width))
      node.width = parseFloat(edit.style.width);
    if (edit.style?.height && /^\d+(\.\d+)?px$/.test(edit.style.height))
      node.height = parseFloat(edit.style.height);
  }
  move(id: string, dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy))
      throw new Error("Invalid move.");
    const node = this.find(id);
    if (!node) throw new Error("Select a layer.");
    const [x = 0, y = 0] = (node.style.translate ?? "0 0")
      .split(/\s+/)
      .map(parseFloat);
    this.apply(id, {
      style: {
        translate: `${Math.round((x + dx) * 100) / 100}px ${Math.round((y + dy) * 100) / 100}px`,
      },
    });
  }
  reset(id: string) {
    const node = this.find(id),
      original = this.original.pages
        .flatMap((page) => walk(page.root))
        .find((node) => node.id === id);
    if (!node || !original) return;
    this.remember();
    Object.assign(
      node,
      JSON.parse(JSON.stringify({ ...original, children: node.children })),
    );
  }
  undo() {
    const previous = this.history.pop();
    if (previous) {
      this.future.push(clone(this.doc));
      this.doc = previous;
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.history.push(clone(this.doc));
      this.doc = next;
    }
  }
}
