import type { Files } from "../ir/types";

/** File overrides survive visual regeneration, until explicitly reset. */
export class CodeEditor {
  private base: Files = {};
  private overrides: Record<string, string> = {};
  private path = "";
  private timer?: ReturnType<typeof setTimeout>;
  private el = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  constructor(private changed: (files: Files) => void) {
    this.el("code-open").onclick = () => {
      this.el<HTMLDialogElement>("code-dialog").showModal();
      this.populate();
    };
    this.el("code-close").onclick = () => {
      this.flush();
      this.el<HTMLDialogElement>("code-dialog").close();
    };
    this.el("code-file").onchange = () => {
      this.flush();
      this.path = this.el<HTMLSelectElement>("code-file").value;
      this.showFile();
    };
    this.el("code-content").oninput = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 400);
    };
    this.el("code-reset").onclick = () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      delete this.overrides[this.path];
      this.showFile();
      this.changed(this.files);
    };
    this.el("code-add-js").onclick = () => {
      this.flush();
      if (!this.files["js/script.js"])
        this.overrides["js/script.js"] =
          "'use strict';\n\n// Add your website interactions here.\n";
      for (const [path, content] of Object.entries(this.files)) {
        if (
          path.endsWith(".html") &&
          typeof content === "string" &&
          !content.includes(
            'src="' +
              (path.startsWith("pages/") ? "../" : "") +
              'js/script.js"',
          )
        ) {
          const script = `<script src="${path.startsWith("pages/") ? "../" : ""}js/script.js" defer></script>`;
          this.overrides[path] = content.replace(
            "</body>",
            `${script}\n</body>`,
          );
        }
      }
      this.path = "js/script.js";
      this.populate();
      this.changed(this.files);
    };
  }
  get files(): Files {
    const files = { ...this.base, ...this.overrides };
    const faces = String(this.base["css/styles.css"] ?? "").match(
      /^@font-face[^\n]*(?:\n@font-face[^\n]*)*/,
    )?.[0];
    if (faces && this.overrides["css/styles.css"] !== undefined) {
      const css = String(files["css/styles.css"]);
      // Keep uploaded faces even when the stylesheet has a manual override.
      if (!css.includes(faces))
        files["css/styles.css"] = css + "\n" + faces + "\n";
    }
    return files;
  }
  load(files: Files) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.base = files;
    this.overrides = {};
    this.path = "";
    this.populate();
    this.el<HTMLButtonElement>("code-open").disabled = false;
  }
  regenerate(files: Files) {
    this.flush();
    this.base = files;
    this.populate();
    this.changed(this.files);
  }
  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.base = {};
    this.overrides = {};
    this.el<HTMLDialogElement>("code-dialog").close();
    this.el<HTMLButtonElement>("code-open").disabled = true;
  }
  flush() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.path) return;
    this.overrides[this.path] =
      this.el<HTMLTextAreaElement>("code-content").value;
    this.changed(this.files);
    this.mark();
  }
  private populate() {
    const paths = Object.keys(this.files).filter((path) =>
      /\.(html|css|js)$/.test(path),
    );
    if (!paths.includes(this.path))
      this.path = paths.find((path) => path === "index.html") ?? paths[0] ?? "";
    this.el<HTMLSelectElement>("code-file").replaceChildren(
      ...paths.map((path) => new Option(path, path)),
    );
    this.el<HTMLSelectElement>("code-file").value = this.path;
    this.showFile();
  }
  private showFile() {
    this.el<HTMLTextAreaElement>("code-content").value = String(
      this.files[this.path] ?? "",
    );
    this.mark();
  }
  private mark() {
    this.el("code-note").textContent =
      this.overrides[this.path] !== undefined
        ? "Manual file override: retained in preview and ZIP. Visual edits to this file take effect after Reset file."
        : "Generated file. Edits save automatically to the preview and ZIP. JavaScript runs in the exported website.";
  }
}
