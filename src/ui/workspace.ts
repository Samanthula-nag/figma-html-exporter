/** Arrange existing controls without replacing their IDs or editor behavior. */
const get = (id: string) => document.getElementById(id)!;
const workspace = get("workspace");
const editor = get("editor");
const main = document.querySelector("main")!;
const sidebar = document.createElement("aside");
sidebar.id = "workspace-sidebar";
sidebar.setAttribute("aria-label", "Workspace panels");
const tabs = document.createElement("nav");
tabs.className = "panel-tabs";
tabs.setAttribute("aria-label", "Inspector sections");
const panels: HTMLElement[] = [];
for (const name of ["Layers", "Design", "Project"]) {
  const panel = document.createElement("section");
  panel.id = "panel-" + name.toLowerCase();
  panel.className = "workspace-panel";
  panel.hidden = name !== "Layers";
  const button = document.createElement("button");
  button.textContent = name;
  button.setAttribute("aria-controls", panel.id);
  button.setAttribute("aria-pressed", String(!panel.hidden));
  button.onclick = () => {
    panels.forEach((p) => (p.hidden = p !== panel));
    Array.from(tabs.children).forEach((b) =>
      b.setAttribute("aria-pressed", String(b === button)),
    );
  };
  tabs.append(button);
  panels.push(panel);
}
const [layers, design, project] = panels;
const help = editor.querySelector("p.hint")!;
const shortcuts = document.createElement("details");
shortcuts.innerHTML = "<summary>Canvas shortcuts</summary>";
shortcuts.append(help);
layers.append(
  editor.querySelector("label")!,
  get("layer-search"),
  get("edit-layer"),
);
const actions = document.createElement("div");
actions.className = "layer-actions";
for (const id of [
  "edit-parent",
  "edit-duplicate",
  "edit-front",
  "edit-back",
  "edit-delete",
  "edit-undo",
  "edit-redo",
  "edit-reset",
])
  actions.append(get(id));
layers.append(actions, get("source-selection-status"), shortcuts);
design.innerHTML =
  "<h2>Layer properties</h2><p class='hint'>Select a layer on the canvas or in Layers. Changes save automatically.</p>";
design.append(get("edit-fields"), get("edit-status"));
const prepare = document.querySelector("body > section")!;
project.append(prepare);
for (const id of [
  "connection",
  "check-connection",
  "sync-status",
  "stats",
  "reference-status",
])
  project.append(get(id));
project.append(document.querySelector("#diagnostic-title")!.parentElement!);
const bar = workspace.querySelector(".previewbar")!;
const tools = document.createElement("div");
tools.className = "project-actions";
for (const id of [
  "figma-selection-card",
  "import-selection",
  "auto-responsive",
  "code-open",
])
  tools.append(get(id));
project.prepend(tools);
sidebar.append(tabs, ...panels);
editor.replaceWith(sidebar);
// Keep the editor's hidden state as a controller-owned lifecycle marker.
sidebar.append(editor);
editor.style.display = "none";
const splitter = document.createElement("div");
splitter.id = "panel-splitter";
splitter.tabIndex = 0;
splitter.setAttribute("role", "separator");
splitter.setAttribute("aria-label", "Resize inspector");
splitter.setAttribute("aria-orientation", "vertical");
let panelWidth = 280;
function resize(width: number) {
  panelWidth = Math.max(220, Math.min(420, innerWidth - 330, width));
  workspace.style.setProperty("--panel-width", panelWidth + "px");
  splitter.setAttribute("aria-valuenow", String(panelWidth));
}
splitter.onpointerdown = (e) => {
  splitter.setPointerCapture(e.pointerId);
  const start = e.clientX,
    width = panelWidth;
  const move = (event: PointerEvent) => resize(width + event.clientX - start);
  const stop = () => {
    splitter.removeEventListener("pointermove", move);
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", stop, { once: true });
  splitter.addEventListener("pointercancel", stop, { once: true });
};
splitter.onkeydown = (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  resize(panelWidth + (e.key === "ArrowRight" ? 20 : -20));
};
workspace.append(splitter);
const toggle = document.createElement("button");
toggle.id = "toggle-panels";
toggle.textContent = "Hide panels";
toggle.setAttribute("aria-expanded", "true");
toggle.onclick = () => {
  const hidden = workspace.classList.toggle("panels-hidden");
  toggle.textContent = hidden ? "Show panels" : "Hide panels";
  toggle.setAttribute("aria-expanded", String(!hidden));
};
bar.prepend(toggle);
const footer = document.createElement("footer");
footer.id = "workspace-status";
footer.append(get("status"), get("analysis-progress"));
// All supporting content is now in Project; keep the canvas at a stable height.
main.replaceChildren(workspace, footer);
resize(panelWidth);

// Keep source import within reach beside the canvas.
bar.append(get("figma-selection-card"), get("import-selection"));
