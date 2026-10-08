import type { DocumentModel, Files, NodeModel, Style } from "../ir/types";
import { walk } from "../generators/html";
import { buildProject } from "../exporter/project-builder";
import { EditorSession } from "./session";
import { editablePreview } from "./editor-preview";
import { validate } from "../validation/export-validator";
import type { ImportedSelection } from "../analyzer/import-selection";

export class EditorController {
  private selectSource() {
    const nodes = this.pageNodes().filter((node) =>
      this.selectedIds.includes(node.id),
    );
    window.dispatchEvent(
      new CustomEvent("select-source-layers", {
        detail: {
          ids: [
            ...new Set(
              nodes.flatMap((node) => (node.sourceId ? [node.sourceId] : [])),
            ),
          ],
          unmapped: nodes.filter((node) => !node.sourceId).length,
        },
      }),
    );
  }
  private session?: EditorSession;
  private selectedId?: string;
  private selectedIds: string[] = [];
  private editTimer?: ReturnType<typeof setTimeout>;
  private prototypeHistory: string[] = [];
  private token = "";
  private ready = false;
  private viewportCaptured?: () => void;
  async captureViewport() {
    if (!this.session) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.viewportCaptured = undefined;
        resolve();
      }, 300);
      this.viewportCaptured = () => {
        clearTimeout(timer);
        this.viewportCaptured = undefined;
        resolve();
      };
      this.el<HTMLIFrameElement>("frame").contentWindow?.postMessage(
        { type: "capture-viewport", token: this.token },
        "*",
      );
    });
  }
  get viewportScroll() {
    return { x: this.scrollX, y: this.scrollY };
  }
  setViewportScroll(x: number, y: number) {
    this.scrollX = Math.max(0, x);
    this.scrollY = Math.max(0, y);
    this.el<HTMLIFrameElement>("frame").contentWindow?.postMessage(
      {
        type: "set-viewport",
        token: this.token,
        x: this.scrollX,
        y: this.scrollY,
      },
      "*",
    );
  }
  private scrollX = 0;
  private scrollY = 0;
  private measured?: { width: number; height: number };
  private dirty = new Set<string>();
  private el = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  constructor(
    private changed: (result: {
      files: Files;
      errors: string[];
      warnings: string[];
      doc: DocumentModel;
    }) => void,
    private refresh: () => void,
  ) {
    for (const action of ["duplicate", "front", "back"])
      this.el("edit-" + action).onclick = () => this.layerAction(action);
    this.el("edit-delete").onclick = () => this.deleteSelection();
    this.el("quick-colour-close").onclick = () => {
      this.flush();
      this.el<HTMLDialogElement>("quick-colour-dialog").close();
    };
    this.el("quick-colour").oninput = () => {
      this.el<HTMLInputElement>("edit-color").value =
        this.el<HTMLInputElement>("quick-colour").value;
      this.el("edit-color").dispatchEvent(
        new Event("input", { bubbles: true }),
      );
    };
    this.el("layer-search").oninput = () => {
      const query = this.el<HTMLInputElement>("layer-search")
        .value.toLowerCase()
        .trim();
      for (const option of this.el<HTMLSelectElement>("edit-layer").options)
        option.hidden = !!query && !option.text.toLowerCase().includes(query);
    };
    this.el("auto-responsive").onclick = () => {
      this.flush();
      this.session?.autoResponsive();
      this.commit();
      this.el("edit-status").textContent =
        "Responsive rules added for all pages. Review mobile, tablet and desktop previews; Ctrl+Z reverts.";
    };
    this.el("edit-mode").onchange = () => {
      this.flush();
      this.refresh();
    };
    this.el("prototype-mode").onchange = () => {
      this.flush();
      this.populate();
      this.refresh();
    };
    this.el("prototype-back").onclick = () => this.goBack();
    window.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).closest("dialog")) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "d" &&
        !(event.target as HTMLElement).closest(
          "input,textarea,[contenteditable=true]",
        )
      ) {
        event.preventDefault();
        this.layerAction("duplicate");
        return;
      }
      if (
        ["Delete", "Backspace"].includes(event.key) &&
        !(event.target as HTMLElement).closest(
          "input,textarea,[contenteditable=true]",
        )
      ) {
        event.preventDefault();
        this.deleteSelection();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["z", "y"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        this.history(event.shiftKey || event.key.toLowerCase() === "y");
      }
    });
    this.el("edit-layer").onchange = () => {
      const wasEditing = this.el<HTMLInputElement>("edit-mode").checked;
      this.el<HTMLInputElement>("edit-mode").checked = true;
      const ids = Array.from(
        this.el<HTMLSelectElement>("edit-layer").selectedOptions,
        (option) => option.value,
      ).filter(Boolean);
      this.flush();
      this.selectedIds = ids;
      this.selectSource();
      this.selectedId = ids[ids.length - 1];
      this.measured = undefined;
      this.populate();
      if (
        this.ready &&
        wasEditing &&
        !this.el<HTMLInputElement>("prototype-mode").checked
      ) {
        this.el<HTMLIFrameElement>("frame").contentWindow?.postMessage(
          { type: "select-layers", token: this.token, ids: this.selectedIds },
          "*",
        );
      } else this.refresh();
    };
    this.el("edit-parent").onclick = () => {
      if (!this.session || !this.selectedId) return;
      const parent = this.session.doc.pages
        .flatMap((p) => walk(p.root))
        .find((n) => n.children.some((c) => c.id === this.selectedId));
      if (parent) {
        this.el<HTMLInputElement>("edit-mode").checked = true;
        this.flush();
        this.selectedId = parent.id;
        this.selectedIds = [parent.id];
        this.selectSource();
        this.measured = undefined;
        this.populate();
        this.refresh();
      }
    };
    this.el("edit-fields").addEventListener("input", (e) => {
      this.dirty.add((e.target as HTMLElement).id);
      clearTimeout(this.editTimer);
      this.editTimer = setTimeout(() => this.flush(), 350);
    });

    this.el("edit-color-picker").oninput = () => {
      this.el<HTMLInputElement>("edit-color").value =
        this.el<HTMLInputElement>("edit-color-picker").value;
      this.dirty.add("edit-color");
    };
    this.el("edit-undo").onclick = () => {
      this.history(false);
    };
    this.el("edit-redo").onclick = () => {
      this.history(true);
    };
    this.el("edit-reset").onclick = () => {
      this.flush();
      if (this.selectedIds.length) this.session?.resetMany(this.selectedIds);
      this.commit();
    };
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (
        event.source !== this.el<HTMLIFrameElement>("frame").contentWindow ||
        !message?.exporterEditor ||
        message.token !== this.token ||
        !this.session
      )
        return;
      if (message.type === "editing-start") {
        window.dispatchEvent(new Event("canvas-edit-start"));
        return;
      }
      if (message.type === "pan" && Number.isFinite(message.dx)) {
        this.el("canvas-viewport").scrollLeft += message.dx;
        this.scrollX = Number.isFinite(message.scrollX) ? message.scrollX : 0;
        this.scrollY = Number.isFinite(message.scrollY) ? message.scrollY : 0;
        return;
      }
      if (message.type === "viewport") {
        if (Number.isFinite(message.scrollX)) this.scrollX = message.scrollX;
        if (Number.isFinite(message.scrollY)) this.scrollY = message.scrollY;
        this.viewportCaptured?.();
        return;
      }
      if (message.type === "zoom" && Number.isFinite(message.delta)) {
        window.dispatchEvent(
          new CustomEvent("canvas-zoom-wheel", {
            detail: {
              delta: message.delta,
              x: message.x,
              y: message.y,
              scrollX: message.scrollX,
              scrollY: message.scrollY,
            },
          }),
        );
        return;
      }
      if (message.type === "import-drop") {
        window.dispatchEvent(
          new CustomEvent("import-figma-selection", {
            detail: { ids: message.ids, x: message.x, y: message.y },
          }),
        );
        return;
      }
      if (message.type === "delete") {
        this.deleteSelection();
        return;
      }
      if (
        message.type === "text-colour" &&
        this.session.find(message.id)?.text !== undefined
      ) {
        this.selectedId = message.id;
        this.selectedIds = [message.id];
        this.populate();
        const rgb = String(message.color).match(/\d+/g);
        this.el<HTMLInputElement>("quick-colour").value =
          rgb && rgb.length >= 3
            ? "#" +
              rgb
                .slice(0, 3)
                .map((value) => Number(value).toString(16).padStart(2, "0"))
                .join("")
            : "#000000";
        this.el<HTMLDialogElement>("quick-colour-dialog").showModal();
        return;
      }
      if (message.type === "undo" || message.type === "redo") {
        this.history(message.type === "redo");
        return;
      }
      if (message.type === "back") {
        this.goBack();
        return;
      }
      if (
        message.type === "navigate" &&
        this.el<HTMLInputElement>("prototype-mode").checked
      ) {
        const current = this.el<HTMLSelectElement>("pages").value;
        const url = new URL(
          String(message.href),
          "https://preview.local/" + current,
        );
        const page = this.session.doc.pages.find(
          (page) =>
            "/" + page.path === url.pathname &&
            url.origin === "https://preview.local",
        );
        if (page) {
          this.prototypeHistory.push(current);
          this.el<HTMLSelectElement>("pages").value = page.path;
          this.pageChanged();
          this.refresh();
        } else
          this.el("edit-status").textContent =
            "External links can be tested in the exported website.";
        return;
      }
      if (["duplicate", "front", "back"].includes(message.type)) {
        this.layerAction(message.type);
        return;
      }
      if (message.type === "select") {
        this.ready = true;
        if (this.dirty.size && !message.user) return;
        const pending = this.dirty.size > 0;
        if (pending) this.flush();
        this.selectedIds = Array.isArray(message.ids)
          ? message.ids.filter((id: string) =>
              this.pageNodes().some((n) => n.id === id),
            )
          : [];
        this.selectedId = this.selectedIds[this.selectedIds.length - 1];
        this.measured = this.selectedId
          ? { width: message.width, height: message.height }
          : undefined;
        this.scrollX = Number.isFinite(message.scrollX) ? message.scrollX : 0;
        this.scrollY = Number.isFinite(message.scrollY) ? message.scrollY : 0;
        this.populate();
        if (message.user) this.selectSource();
        if (pending) this.refresh();
        return;
      }
      if (!this.pageNodes().some((n) => n.id === message.id)) return;
      this.selectedId = message.id;
      this.scrollX = Number.isFinite(message.scrollX) ? message.scrollX : 0;
      this.scrollY = Number.isFinite(message.scrollY) ? message.scrollY : 0;
      try {
        if (message.type === "move")
          this.session.moveMany(
            this.selectedIds.length ? this.selectedIds : [message.id],
            message.dx,
            message.dy,
          );
        else if (message.type === "rotate" && Number.isFinite(message.angle))
          this.session.apply(message.id, {
            style: { rotate: message.angle + "deg" },
          });
        else if (
          message.type === "resize" &&
          [message.width, message.height].every(
            (n) => Number.isFinite(n) && n > 0,
          )
        )
          this.session.apply(message.id, {
            style: {
              width: `${message.width}px`,
              height: `${message.height}px`,
              "min-width": "0",
              "min-height": "0",
              "max-width": "none",
              "max-height": "none",
            },
          });
        else return;
        this.commit();
      } catch (error) {
        this.el("edit-status").textContent = String(error);
      }
    });
  }
  private layerAction(action: string) {
    if (
      !this.session ||
      !this.selectedIds.length ||
      this.el<HTMLInputElement>("prototype-mode").checked
    )
      return;
    this.flush();
    try {
      if (action === "duplicate") {
        this.selectedIds = this.session.duplicateMany(this.selectedIds);
        this.selectedId = this.selectedIds[this.selectedIds.length - 1];
      } else this.session.arrangeMany(this.selectedIds, action === "front");
      this.commit();
    } catch (error) {
      this.el("edit-status").textContent = String(error);
    }
  }
  addWebFont(font: import("../ir/types").WebFont) {
    if (!this.session) throw new Error("Analyze a design first.");
    this.flush();
    this.session.addWebFont(font);
    this.commit();
  }
  flush() {
    clearTimeout(this.editTimer);
    this.editTimer = undefined;
    if (this.dirty.size) this.applyFields();
  }
  validateFiles(files: Files) {
    return this.session ? validate(this.session.doc, files) : [];
  }
  dropSelection(ids: string[], x: number, y: number) {
    this.el<HTMLIFrameElement>("frame").contentWindow?.postMessage(
      { type: "import-at", token: this.token, ids, x, y },
      "*",
    );
  }
  private deleteSelection() {
    if (
      this.el<HTMLInputElement>("prototype-mode").checked ||
      !this.selectedIds.length
    )
      return;
    this.flush();
    try {
      this.session?.deleteMany(this.selectedIds);
      this.selectedIds = [];
      this.selectedId = undefined;
      this.commit();
    } catch (error) {
      this.el("edit-status").textContent = String(error);
    }
  }
  importSelection(
    path: string,
    selection: ImportedSelection,
    x: number,
    y: number,
  ) {
    if (!this.session) return;
    this.flush();
    this.selectedIds = this.session.importInto(path, selection, x, y);
    this.el<HTMLSelectElement>("pages").value = path;
    this.selectedId = this.selectedIds[this.selectedIds.length - 1];
    this.commit();
  }
  private history(redo: boolean) {
    this.flush();
    if (redo) this.session?.redo();
    else this.session?.undo();
    this.commit();
  }
  private goBack() {
    const path = this.prototypeHistory.pop();
    if (path) {
      this.el<HTMLSelectElement>("pages").value = path;
      this.pageChanged();
      this.refresh();
    }
  }
  load(doc: DocumentModel, preserveViewport = false) {
    const previous = {
      x: this.scrollX,
      y: this.scrollY,
      ids: this.selectedIds,
    };
    this.el<HTMLButtonElement>("auto-responsive").disabled = false;
    clearTimeout(this.editTimer);
    this.dirty.clear();
    this.prototypeHistory = [];
    this.session = new EditorSession(doc);
    this.selectedId = undefined;
    this.scrollX = this.scrollY = 0;
    this.el("editor").hidden = false;
    this.pageChanged();
    if (preserveViewport) {
      this.scrollX = previous.x;
      this.scrollY = previous.y;
      this.selectedIds = previous.ids.filter((id) =>
        this.pageNodes().some((node) => node.id === id),
      );
      this.selectedId = this.selectedIds[this.selectedIds.length - 1];
      this.populate();
    }
  }
  clear() {
    this.el<HTMLButtonElement>("auto-responsive").disabled = true;
    clearTimeout(this.editTimer);
    this.dirty.clear();
    this.selectedIds = [];
    this.session = undefined;
    this.token = "";
    this.el("editor").hidden = true;
  }
  private pageNodes(): NodeModel[] {
    const page = this.session?.doc.pages.find(
      (p) => p.path === this.el<HTMLSelectElement>("pages").value,
    );
    return page ? walk(page.root) : [];
  }
  pageChanged() {
    this.el<HTMLInputElement>("layer-search").value = "";
    for (const option of this.el<HTMLSelectElement>("edit-layer").options)
      option.hidden = false;
    this.flush();
    this.selectedIds = [];
    this.selectedId = undefined;
    this.scrollX = this.scrollY = 0;
    this.populate();
  }
  wrap(html: string): string {
    this.ready = false;
    this.token = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const enabled = !!this.session;
    this.el<HTMLIFrameElement>("frame").setAttribute(
      "sandbox",
      enabled ? "allow-scripts" : "",
    );
    if (!enabled) return html;
    const layers = Object.fromEntries(
      this.pageNodes().map((node) => [node.className, node.id]),
    );
    return editablePreview(html, {
      token: this.token,
      layers,
      selectedId: this.selectedId,
      selectedIds: this.selectedIds,
      textIds: this.pageNodes()
        .filter((node) => node.text !== undefined)
        .map((node) => node.id),
      rootClass: this.pageNodes()[0]?.className,
      prototype: this.el<HTMLInputElement>("prototype-mode").checked,
      viewOnly:
        !this.el<HTMLInputElement>("edit-mode").checked &&
        !this.el<HTMLInputElement>("prototype-mode").checked,
      focusCanvas: document.activeElement === this.el("frame"),
      scrollX: this.scrollX,
      scrollY: this.scrollY,
    });
  }
  private populate() {
    this.el("auto-responsive").textContent = this.session?.doc.autoResponsive
      ? "Responsive enabled · all pages"
      : "Auto responsive · all pages";
    const nodes = this.pageNodes(),
      select = this.el<HTMLSelectElement>("edit-layer");
    if (
      Array.from(select.options)
        .map((option) => option.value)
        .join("|") !== ["", ...nodes.map((node) => node.id)].join("|")
    )
      select.replaceChildren(
        new Option("Select a layer…", ""),
        ...nodes.map((n) => new Option(`${n.name} · ${n.tag}`, n.id)),
      );
    for (const option of select.options)
      option.selected = this.selectedIds.includes(option.value);
    this.dirty.clear();
    const node = this.selectedId
      ? this.session?.find(this.selectedId)
      : undefined;
    this.el<HTMLFieldSetElement>("edit-fields").disabled =
      !node || this.el<HTMLInputElement>("prototype-mode").checked;
    this.el<HTMLButtonElement>("edit-parent").disabled = !node;
    this.el<HTMLButtonElement>("edit-reset").disabled = !node;
    this.el<HTMLButtonElement>("edit-delete").disabled = !node;
    for (const action of ["duplicate", "front", "back"])
      this.el<HTMLButtonElement>("edit-" + action).disabled =
        !node || this.el<HTMLInputElement>("prototype-mode").checked;
    this.el<HTMLButtonElement>("edit-undo").disabled = !this.session?.canUndo;
    this.el<HTMLButtonElement>("edit-redo").disabled = !this.session?.canRedo;
    if (!node) {
      this.el("edit-fields")
        .querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input, select, textarea")
        .forEach((field) => {
          field.value = "";
        });
      this.el("edit-status").textContent =
        "Select a layer in the website or choose one from the list.";
      return;
    }
    const translation = (node.style.translate ?? "0 0")
      .split(/\s+/)
      .map(parseFloat);
    const values: Record<string, string> = {
      "edit-x": String(translation[0] || 0),
      "edit-y": String(translation[1] || 0),
      "edit-width": String(Math.round(this.measured?.width ?? node.width)),
      "edit-height": String(Math.round(this.measured?.height ?? node.height)),
      "edit-font": String(parseFloat(node.style["font-size"]) || ""),
      "edit-gap": String(parseFloat(node.style.gap) || 0),
      "edit-direction": node.style["flex-direction"] ?? "",
      "edit-wrap": node.style["white-space"] ?? "",
      "edit-text": node.text ?? "",
      "edit-color": node.style.color ?? "",
      "edit-rotation": String(parseFloat(node.style.rotate ?? "0") || 0),
      "edit-align": node.style["text-align"] ?? "",
      "edit-words": "",
      "edit-family": node.style["font-family"] ?? "",
      "edit-weight": node.style["font-weight"] ?? "400",
      "edit-font-style": node.style["font-style"] ?? "normal",
      "edit-decoration": node.style["text-decoration"] ?? "none",
    };
    for (const [id, value] of Object.entries(values))
      this.el<HTMLInputElement>(id).value = value;
    this.el<HTMLTextAreaElement>("edit-text").disabled =
      node.text === undefined || this.selectedIds.length > 1;
    this.el<HTMLSelectElement>("edit-words").disabled = node.text === undefined;
    this.el<HTMLInputElement>("edit-color-picker").value =
      /^#[0-9a-f]{6}$/i.test(node.style.color ?? "")
        ? node.style.color
        : "#000000";
    this.el("edit-status").textContent =
      `Selected: ${this.selectedIds.length > 1 ? this.selectedIds.length + " layers (shared fields edit all)" : node.name}. Drag to move; use the corner handle to resize. Arrow keys move 1px; Shift moves 10px.`;
  }
  private applyFields() {
    if (!this.session || !this.selectedId) return;
    try {
      const style: Style = {};
      for (const [field, property] of [
        ["family", "font-family"],
        ["weight", "font-weight"],
        ["font-style", "font-style"],
        ["decoration", "text-decoration"],
      ]) {
        if (this.dirty.has(`edit-${field}`)) {
          const value = this.el<HTMLInputElement>(`edit-${field}`).value.trim();
          if (!CSS.supports(property, value))
            throw new Error(`Invalid ${property}.`);
          style[property] = value;
        }
      }
      if (this.dirty.has("edit-color")) {
        const color = this.el<HTMLInputElement>("edit-color").value.trim();
        if (!CSS.supports("color", color))
          throw new Error("Enter a valid text colour, such as #ff9900.");
        style.color = color;
      }
      if (this.dirty.has("edit-rotation")) {
        const rotation = Number(
          this.el<HTMLInputElement>("edit-rotation").value,
        );
        if (!Number.isFinite(rotation))
          throw new Error("Rotation must be a valid number of degrees.");
        style.rotate = `${rotation}deg`;
      }
      if (this.dirty.has("edit-align")) {
        const alignment = this.el<HTMLSelectElement>("edit-align").value;
        if (alignment) style["text-align"] = alignment;
      }
      for (const [field, property] of [
        ["width", "width"],
        ["height", "height"],
        ["font", "font-size"],
        ["gap", "gap"],
      ])
        if (this.dirty.has(`edit-${field}`)) {
          const number = Number(
            this.el<HTMLInputElement>(`edit-${field}`).value,
          );
          if (!Number.isFinite(number) || number < (field === "gap" ? 0 : 1))
            throw new Error(`${field} must be a valid positive size.`);
          style[property] = `${number}px`;
          if (field === "width" || field === "height") {
            style[`min-${field}`] = "0";
            style[`max-${field}`] = "none";
          }
        }
      if (this.dirty.has("edit-x") || this.dirty.has("edit-y")) {
        const x = Number(this.el<HTMLInputElement>("edit-x").value),
          y = Number(this.el<HTMLInputElement>("edit-y").value);
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error("Offsets must be valid numbers.");
        style.translate = `${x}px ${y}px`;
      }
      if (this.dirty.has("edit-direction")) {
        const direction = this.el<HTMLSelectElement>("edit-direction").value;
        if (direction) {
          style.display = "flex";
          style["flex-direction"] = direction;
          style["flex-wrap"] = "nowrap";
        }
      }
      if (this.dirty.has("edit-wrap")) {
        const wrap = this.el<HTMLSelectElement>("edit-wrap").value;
        if (wrap) style["white-space"] = wrap;
      }
      if (!this.dirty.size) return;
      let text = this.dirty.has("edit-text")
        ? this.el<HTMLTextAreaElement>("edit-text").value
        : undefined;
      if (this.dirty.has("edit-words")) {
        const arrangement = this.el<HTMLSelectElement>("edit-words").value;
        if (arrangement) {
          const words = (text ?? this.session.find(this.selectedId)?.text ?? "")
            .trim()
            .split(/\s+/);
          text = words.join(arrangement === "stack" ? "\n" : " ");
          style["white-space"] =
            arrangement === "stack" ? "pre-wrap" : "nowrap";
        }
      }
      this.session.applyMany(
        this.selectedIds.length ? this.selectedIds : [this.selectedId],
        {
          style,
          ...(text !== undefined ? { text } : {}),
        },
      );
      this.commit();
    } catch (error) {
      this.el("edit-status").textContent = String(error);
    }
  }
  private commit() {
    if (!this.session) return;
    const result = buildProject(this.session.doc);
    this.measured = undefined;
    this.populate();
    this.changed({
      ...result,
      warnings: this.session.doc.warnings,
      doc: this.session.doc,
    });
    this.el("edit-status").textContent = result.errors.length
      ? "Edit has validation errors. Fix them before export."
      : "Correction applied to the preview and ZIP output.";
  }
}
