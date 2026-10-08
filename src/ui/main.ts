import { installWindowResize } from "./window-resize";
import "./workspace";
import { buildProject } from "../exporter/project-builder";
import { applyWebFonts, fontVariants } from "../fonts/web-fonts";
import type { WebFont } from "../ir/types";
import { describeWarning, type ExportWarning } from "../diagnostics/warnings";
import type { DocumentModel, Files } from "../ir/types";
import { walk } from "../generators/html";
import { preview } from "../preview/preview";
import { zip } from "../exporter/zip-builder";
import { BUILD_ID } from "../plugin/version";
import { EditorController } from "../editor/controller";
import { CodeEditor } from "../editor/code-editor";
declare const __PLUGIN_ID__: string;
function sendToPlugin(pluginMessage: unknown) {
  parent.postMessage({ pluginMessage, pluginId: __PLUGIN_ID__ }, "*");
}
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let suppliedFonts: WebFont[] = [];
let displayedWarnings: ExportWarning[] = [];
let sourceWidths = new Map<string, number>();
let fixedSource = false;
function pauseLiveSync() {
  const toggle = el<HTMLInputElement>("live-sync");
  if (!toggle.checked) return;
  toggle.checked = false;
  sendToPlugin({ type: "set-live-sync", enabled: false });
  el("sync-status").textContent =
    "Live sync paused to keep plugin edits. Enable it to refresh from Figma (replaces these edits).";
}
el("live-sync").onchange = () =>
  sendToPlugin({
    type: "set-live-sync",
    enabled: el<HTMLInputElement>("live-sync").checked,
  });
window.addEventListener("canvas-edit-start", pauseLiveSync);
el("edit-fields").addEventListener("input", pauseLiveSync);
el("code-content").addEventListener("input", pauseLiveSync);
let repairRunning = false;
let hasAnalysis = false;
function updateFixCount() {
  const includeImages = el<HTMLInputElement>("warning-images").checked;
  const count = new Set(
    displayedWarnings
      .filter((w) => w.fix === "marker" || (includeImages && w.fix === "image"))
      .map((w) => w.nodeId),
  ).size;
  el<HTMLButtonElement>("fix-warnings").disabled =
    !hasAnalysis || repairRunning;
  el("fix-warnings").textContent =
    "Repair and re-import from Figma (" + count + " source fixes)";
}
function showWarnings(doc: DocumentModel) {
  const remaining = [...(doc.diagnostics ?? [])];
  displayedWarnings = doc.warnings.map((message) => {
    const index = remaining.findIndex((w) => w.message === message);
    return index < 0 ? describeWarning(message) : remaining.splice(index, 1)[0];
  });
  el("warning-list").replaceChildren(
    ...displayedWarnings.map((w) => {
      const row = document.createElement("li");
      row.style.marginBottom = "16px";
      const title = document.createElement("strong");
      title.textContent = w.message;
      const advice = document.createElement("p");
      advice.textContent =
        w.advice +
        (w.fix === "marker"
          ? " Automatic action: add the missing reference square."
          : w.fix === "image"
            ? " Optional automatic action: enable image fallback."
            : " Manual review / informational.");
      row.append(title, advice);
      if (w.nodeId) {
        const button = document.createElement("button");
        button.textContent = "Show layer in Figma";
        button.onclick = () =>
          sendToPlugin({ type: "focus-warning", nodeId: w.nodeId });
        row.append(button);
      }
      return row;
    }),
  );
  el("warning-notes").replaceChildren(
    ...(doc.exportNotes ?? []).map((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      return li;
    }),
  );
  el("warning-action-status").textContent = displayedWarnings.length
    ? "One click applies supported source fixes and re-imports the original analyzed frames at their Figma positions. This replaces plugin edits, imported additions and manual code edits. Missing fonts and unsupported features remain listed."
    : "No warnings reported. Review the exported website visually; this is not a guarantee of identical rendering.";
  const select = el<HTMLSelectElement>("warning-font-variant"),
    previous = select.value;
  select.replaceChildren(
    ...doc.fonts.flatMap((family) =>
      fontVariants(doc, family).map(
        (variant) =>
          new Option(
            family + " · " + variant.weight + " · " + variant.style,
            JSON.stringify({ family, ...variant }),
          ),
      ),
    ),
  );
  if ([...select.options].some((option) => option.value === previous))
    select.value = previous;
  updateFixCount();
}
el("warning-font-file").onchange = async () => {
  const input = el<HTMLInputElement>("warning-font-file"),
    file = input.files?.[0];
  if (!file) return;
  try {
    const variant = JSON.parse(
      el<HTMLSelectElement>("warning-font-variant").value,
    );
    if (file.size > 15 * 1024 * 1024)
      throw new Error("Choose a font smaller than 15 MB.");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["woff2", "woff", "ttf"].includes(ext ?? ""))
      throw new Error("Use WOFF2, WOFF or TTF.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const dataUrl = "data:font/" + ext + ";base64," + btoa(binary);
    el("warning-font-status").textContent = "Validating font…";
    await new FontFace(variant.family, 'url("' + dataUrl + '")', {
      weight: variant.weight,
      style: variant.style,
    }).load();
    const font: WebFont = { ...variant, dataUrl };
    suppliedFonts = [
      ...suppliedFonts.filter(
        (existing) =>
          existing.family !== font.family ||
          existing.weight !== font.weight ||
          existing.style !== font.style,
      ),
      font,
    ];
    editor.addWebFont(font);
    el("warning-font-status").textContent =
      "Font embedded: " +
      file.name +
      ". Verify that its appearance matches Figma.";
  } catch (error) {
    el("warning-font-status").textContent = String(error);
  } finally {
    input.value = "";
  }
};
el("warning-images").onchange = updateFixCount;
el("warning-close").onclick = () =>
  el<HTMLDialogElement>("warning-dialog").close();
el("fix-warnings").onclick = () => {
  repairRunning = true;
  updateFixCount();
  for (const id of ["selection", "page"])
    el<HTMLButtonElement>(id).disabled = true;
  el("warning-action-status").textContent =
    "Repairing supported issues and re-importing the original frames…";
  analysisProgress(0);
  watchResponse(false);
  sendToPlugin({
    type: "fix-warnings",
    includeImages: el<HTMLInputElement>("warning-images").checked,
  });
};
installWindowResize(sendToPlugin);
let figmaSelection: string[] = [];
let importCounter = 0;
let pendingImport:
  { requestId: number; path: string; x: number; y: number } | undefined;
let files: Files = {},
  urls: string[] = [];
const codeEditor = new CodeEditor((updated) => {
  files = updated;
  const errors = editor.validateFiles(files);
  el<HTMLButtonElement>("export").disabled = errors.length > 0;
  el("code-errors").textContent = errors.length
    ? errors.join("\n")
    : "HTML and CSS validation passed. Test edited JavaScript in the exported website.";
  el("errors").replaceChildren(
    ...errors.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
  show();
});
const editor = new EditorController(
  (result) => {
    pauseLiveSync();
    showWarnings(result.doc);
    const countButton = document.getElementById("warning-count");
    if (countButton) {
      countButton.setAttribute(
        "aria-label",
        "Show " + result.doc.warnings.length + " export warnings",
      );
      countButton.querySelector("b")!.textContent = String(
        result.doc.warnings.length,
      );
    }
    codeEditor.regenerate(result.files);
    el<HTMLButtonElement>("export").disabled =
      result.errors.length > 0 || editor.validateFiles(files).length > 0;
    status(
      result.errors.length
        ? "Validation failed. Review diagnostics."
        : "Layout corrections saved for export.",
    );
  },
  () => show(),
);
let responseTimer: ReturnType<typeof setTimeout> | undefined;
let connected = false;
let connectionTimer: ReturnType<typeof setTimeout> | undefined;
function watchResponse(starting = true) {
  clearTimeout(responseTimer);
  responseTimer = setTimeout(
    () => {
      status(
        starting
          ? "No response from the plugin for 15 seconds. Close and reopen the plugin, then try again."
          : "Figma has not sent an update for 60 seconds. If this persists, close and reopen the plugin.",
      );
    },
    starting ? 15000 : 60000,
  );
}
const status = (text: string) => {
  el("status").textContent = text;
};
function analysisProgress(percent: number) {
  el("analysis-progress").hidden = false;
  el<HTMLProgressElement>("progress-bar").value = percent;
  el("progress-label").textContent = `Analysis ${percent}%`;
}
function show() {
  urls.forEach(URL.revokeObjectURL);
  const result = preview(files, el<HTMLSelectElement>("pages").value);
  urls = result.urls;
  const frame = el<HTMLIFrameElement>("frame");
  frame.style.pointerEvents = "none";
  frame.onload = () => {
    frame.style.pointerEvents = "auto";
  };
  frame.srcdoc = editor.wrap(result.html);
  sizeCanvas();
}
for (const scope of ["selection", "page"])
  el(scope).onclick = () => {
    if (!connected) {
      status("The Figma connection is not ready. Use Check connection below.");
      return;
    }
    for (const id of ["selection", "page", "preview", "export"])
      el<HTMLButtonElement>(id).disabled = true;
    analysisProgress(0);
    hasAnalysis = false;
    displayedWarnings = [];
    updateFixCount();
    el("stats").replaceChildren();
    el("warning-list").replaceChildren();

    pendingImport = undefined;
    editor.clear();
    codeEditor.clear();
    el<HTMLIFrameElement>("frame").srcdoc = "";
    status("Starting analysis — waiting for Figma…");
    watchResponse();
    sendToPlugin({
      type: "analyze",
      scope,
      preserveGeometry: el<HTMLInputElement>("preserve-geometry").checked,
    });
  };
el("prepare-layout").onclick = () => {
  if (!connected) {
    el("prepare-status").textContent = "Connect to Figma first.";
    return;
  }
  el<HTMLButtonElement>("prepare-layout").disabled = true;
  el("prepare-status").textContent = "Preparing original Figma layers…";
  sendToPlugin({
    type: "prepare-layout",
    scope: el<HTMLSelectElement>("prepare-scope").value,
  });
};
window.onmessage = async (event) => {
  // Use Figma's pluginMessage envelope. The desktop host can relay through
  // another window, so comparing event.source to parent drops valid replies.
  const message = event.data?.pluginMessage;
  if (
    !message ||
    ![
      "prepare-result",
      "prepare-error",
      "sync-status",
      "sync-empty",
      "warning-action",
      "pong",
      "figma-selection",
      "import-result",
      "import-error",
      "stage",
      "source-preview",
      "progress",
      "error",
      "result",
    ].includes(message.type)
  )
    return;
  if (message.type === "sync-status") {
    el("sync-status").textContent = message.message;
    return;
  }
  if (message.type === "sync-empty") {
    if (!el<HTMLInputElement>("live-sync").checked) return;
    editor.clear();
    codeEditor.clear();
    files = {};
    el<HTMLIFrameElement>("frame").srcdoc = "";
    el<HTMLButtonElement>("export").disabled = true;
    el("sync-status").textContent =
      "Analyzed frames were hidden, deleted, or moved. Waiting for Figma changes.";
    return;
  }
  if (message.type === "prepare-result" || message.type === "prepare-error") {
    el<HTMLButtonElement>("prepare-layout").disabled = false;
    el("prepare-status").textContent =
      message.type === "prepare-error"
        ? message.message
        : (message.changed
            ? "Prepared " + message.changed + " auto-layout frames in Figma."
            : "No auto-layout frames needed conversion.") +
          (message.skipped.length
            ? " Skipped protected layers: " + message.skipped.join(", ") + "."
            : "") +
          " Review in Figma, then Analyze or Import selection. Nothing was imported automatically.";
    return;
  }
  if (message.type === "warning-action") {
    repairRunning = false;
    clearTimeout(responseTimer);
    for (const id of ["selection", "page"])
      el<HTMLButtonElement>(id).disabled = !connected;
    el("warning-action-status").textContent = message.message;
    updateFixCount();
    return;
  }
  if (message.type === "figma-selection") {
    figmaSelection = message.layers.map((layer: { id: string }) => layer.id);
    el("figma-selection-card").textContent = message.layers.length
      ? "Figma selection: " +
        message.layers.map((layer: { name: string }) => layer.name).join(", ")
      : "Select layers in Figma";
    return;
  }
  if (message.type === "import-result") {
    if (!pendingImport || pendingImport.requestId !== message.requestId) return;
    const request = pendingImport;
    pendingImport = undefined;
    try {
      editor.importSelection(
        request.path,
        message.selection,
        request.x,
        request.y,
      );
      status("Figma layers imported. Ctrl+Z undoes the import.");
    } catch (error) {
      status(String(error));
    }
    return;
  }
  if (message.type === "import-error") {
    pendingImport = undefined;
    status(message.message);
    return;
  }
  if (message.type === "pong") {
    clearTimeout(connectionTimer);
    connected = message.build === BUILD_ID;
    el("connection").textContent = connected
      ? `Connected to Figma · Build ${BUILD_ID}`
      : `Build mismatch: UI ${BUILD_ID}; plugin ${message.build}. Import this project's manifest again.`;
    for (const id of ["selection", "page"])
      el<HTMLButtonElement>(id).disabled = !connected || message.busy;
    if (connected && !message.busy)
      status("Connected. Select frames and click Analyze Selection.");
    return;
  }
  clearTimeout(responseTimer);
  if (message.type === "source-preview") {
    watchResponse(false);
    return;
  }
  if (message.type === "stage") {
    status(message.message);
    if (repairRunning)
      el("warning-action-status").textContent = message.message;
    if (message.message.startsWith("Capturing Figma design")) {
      el("progress-label").textContent = "Capturing source design…";
      el("progress-bar").removeAttribute("value");
    }
    watchResponse(false);
  }
  if (message.type === "progress") {
    const percent =
      message.total > 0
        ? Math.min(100, Math.floor((message.count / message.total) * 1000) / 10)
        : 0;
    analysisProgress(percent);
    if (repairRunning)
      el("warning-action-status").textContent =
        "Re-importing original Figma frames: " + percent + "%";
    status(
      percent === 100
        ? "Analysis 100% — generating and validating website…"
        : `Analyzing ${percent}% — ${message.count} of ${message.total} nodes processed…`,
    );
  }
  if (message.type === "error") {
    status(message.message);
    for (const id of ["selection", "page"])
      el<HTMLButtonElement>(id).disabled = false;
  }
  if (message.type !== "result") return;
  if (message.live && !el<HTMLInputElement>("live-sync").checked) return;
  if (message.live) {
    await editor.captureViewport();
    if (!el<HTMLInputElement>("live-sync").checked) return;
  }
  const previousPage = el<HTMLSelectElement>("pages").value;
  const previousScroll = el("canvas-viewport").scrollLeft;
  analysisProgress(100);
  repairRunning = false;
  hasAnalysis = true;
  const doc: DocumentModel = message.doc;
  applyWebFonts(doc, suppliedFonts);
  fixedSource = doc.preserveGeometry === true;
  sourceWidths = new Map(doc.pages.map((page) => [page.path, page.root.width]));
  if (fixedSource && !message.live)
    el<HTMLSelectElement>("canvas-zoom").value = "fit";

  el("reference-status").textContent = doc.pages
    .map((page) =>
      page.reference
        ? `${page.name}: hierarchy square verified · ${page.reference.width}px design · marker excluded from export`
        : `${page.name}: using frame origin (see diagnostics)`,
    )
    .join(" | ");
  files = message.files;
  showWarnings(doc);
  if (message.repair) {
    el<HTMLInputElement>("preserve-geometry").checked = true;
    el("warning-action-status").textContent =
      "Re-imported original frames. " +
      message.repair.changed +
      " source layers prepared. " +
      doc.warnings.length +
      " warnings remain." +
      (message.repair.skipped.length
        ? " Skipped: " + message.repair.skipped.join("; ")
        : "") +
      " Figma artwork remains editable; plugin edits and manual code were replaced by this import.";
  }
  const nodes = doc.pages.flatMap((p) => walk(p.root));
  const stats = {
    Nodes: nodes.length,
    Components: nodes.filter((n) => n.component).length,
    Images: doc.assets.filter((a) => a.path.endsWith(".png")).length,
    SVGs: doc.assets.filter((a) => a.path.endsWith(".svg")).length,
    Fonts: doc.fonts.length,
    Pages: doc.pages.length,
    Warnings: doc.warnings.length,
    Errors: message.errors.length,
  };
  el("stats").replaceChildren(
    ...Object.entries(stats).map(([key, value]) => {
      const item = document.createElement(
        key === "Warnings" ? "button" : "div",
      );
      if (key === "Warnings") {
        item.id = "warning-count";
        item.setAttribute("aria-label", "Show " + value + " export warnings");
        item.onclick = () =>
          el<HTMLDialogElement>("warning-dialog").showModal();
      }
      item.className = "stat";
      const b = document.createElement("b");
      b.textContent = String(value);
      item.append(b, key);
      return item;
    }),
  );
  el("pages").replaceChildren(
    ...doc.pages.map((p) => {
      const option = document.createElement("option");
      option.value = p.path;
      option.textContent = p.name;
      return option;
    }),
  );
  for (const [id, entries] of [
    ["warnings", doc.warnings],
    ["errors", message.errors],
  ] as [string, string[]][])
    el(id).replaceChildren(
      ...entries.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
  if (message.live && doc.pages.some((page) => page.path === previousPage))
    el<HTMLSelectElement>("pages").value = previousPage;
  editor.load(
    doc,
    !!message.live && doc.pages.some((page) => page.path === previousPage),
  );
  if (doc.webFonts?.length) files = buildProject(doc).files;
  codeEditor.load(files);
  if (message.live) el("canvas-viewport").scrollLeft = previousScroll;
  for (const id of ["selection", "page", "preview"])
    el<HTMLButtonElement>(id).disabled = false;
  el<HTMLButtonElement>("export").disabled = message.errors.length > 0;
  status(
    message.errors.length
      ? "Validation failed. Review diagnostics."
      : "Ready to preview and export.",
  );
  show();
};
function checkConnection() {
  clearTimeout(connectionTimer);
  el("connection").textContent = `Connecting to Figma · Build ${BUILD_ID}`;
  sendToPlugin({ type: "ping" });
  connectionTimer = setTimeout(() => {
    el("connection").textContent =
      `No Figma response · Build ${BUILD_ID}. Import E:/codex/figmatocodenew_justtry/1/manifest.json through Plugins → Development → Import plugin from manifest.`;
    status("Connection failed. Analysis has not started.");
  }, 5000);
}
el("check-connection").onclick = checkConnection;
for (const id of ["selection", "page"])
  el<HTMLButtonElement>(id).disabled = true;
checkConnection();
el("preview").onclick = show;

el("pages").onchange = () => {
  editor.pageChanged();
  show();
};
function sizeCanvas() {
  const viewport = el("canvas-viewport"),
    stage = el("canvas-stage"),
    frame = el("frame");
  const width = el<HTMLSelectElement>("width").value;
  const nativeWidth =
    width === "100%"
      ? fixedSource
        ? (sourceWidths.get(el<HTMLSelectElement>("pages").value) ??
          viewport.clientWidth)
        : viewport.clientWidth
      : parseFloat(width);
  const zoom = el<HTMLSelectElement>("canvas-zoom").value;
  const scale =
    zoom === "fit"
      ? Math.min(1, viewport.clientWidth / nativeWidth)
      : Number(zoom);
  frame.style.width = `${nativeWidth}px`;
  frame.style.height = `${viewport.clientHeight / scale}px`;
  frame.style.transform = `scale(${scale})`;
  stage.style.width = `${nativeWidth * scale}px`;
  stage.style.height = `${viewport.clientHeight}px`;
}
function wheelZoom(
  delta: number,
  clientX: number,
  clientY: number,
  sourceScroll = editor.viewportScroll,
) {
  if (!Number.isFinite(delta) || !delta) return;
  const frame = el("frame"),
    viewport = el("canvas-viewport"),
    select = el<HTMLSelectElement>("canvas-zoom");
  const rect = frame.getBoundingClientRect();
  const current = rect.width / frame.offsetWidth;
  if (!Number.isFinite(current) || current <= 0) return;
  const next = Math.max(
    0.1,
    Math.min(
      4,
      current * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002),
    ),
  );
  const x = Math.max(0, clientX - rect.left),
    y = Math.max(0, clientY - rect.top);
  let custom = select.querySelector<HTMLOptionElement>("[data-custom-zoom]");
  if (!custom) {
    custom = new Option();
    custom.dataset.customZoom = "true";
    select.append(custom);
  }
  custom.value = String(next);
  custom.textContent = (next * 100).toFixed(1) + "%";
  select.value = custom.value;
  const left = viewport.scrollLeft;
  sizeCanvas();
  viewport.scrollLeft = left + x * (next / current - 1);
  editor.setViewportScroll(
    sourceScroll.x,
    sourceScroll.y + y / current - y / next,
  );
}
window.addEventListener("canvas-zoom-wheel", (event) => {
  const data = (event as CustomEvent).detail;
  const frame = el("frame"),
    rect = frame.getBoundingClientRect(),
    scale = rect.width / frame.offsetWidth;
  wheelZoom(data.delta, rect.left + data.x * scale, rect.top + data.y * scale, {
    x: data.scrollX,
    y: data.scrollY,
  });
});
el("canvas-viewport").addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? el("canvas-viewport").clientHeight
          : 1);
    wheelZoom(delta, event.clientX, event.clientY);
  },
  { passive: false },
);
el("width").onchange = sizeCanvas;
el("canvas-zoom").onchange = sizeCanvas;
el("canvas-focus").onclick = () => {
  const expanded = el("workspace").classList.toggle("canvas-focus");
  el("canvas-focus").textContent = expanded
    ? "Exit expanded canvas"
    : "Expand canvas";
  sizeCanvas();
};
new ResizeObserver(sizeCanvas).observe(el("canvas-viewport"));
sizeCanvas();
el("export").onclick = () => {
  try {
    editor.flush();
    codeEditor.flush();
    if (editor.validateFiles(files).length) {
      status("Fix code validation errors before exporting.");
      return;
    }
    const bytes = zip(files),
      url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      );
    const a = document.createElement("a");
    a.href = url;
    a.download = "website.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status("ZIP download prepared.");
  } catch (error) {
    status(`Export failed: ${String(error)}`);
  }
};

function requestImport(ids: string[], x = 24, y = 24) {
  const path = el<HTMLSelectElement>("pages").value;
  if (!path || !Object.keys(files).length) {
    status("Analyze a design first, then import layers into its viewport.");
    return;
  }
  if (pendingImport) {
    status("Import is already running.");
    return;
  }
  if (!ids.length) {
    status("Select layers in Figma first.");
    return;
  }
  pendingImport = { requestId: ++importCounter, path, x, y };
  status("Importing selected Figma layers…");
  sendToPlugin({
    type: "import-selection",
    preserveGeometry: el<HTMLInputElement>("preserve-geometry").checked,
    ids,
    requestId: pendingImport.requestId,
  });
}
el("figma-selection-card").ondragstart = (event) => {
  if (!figmaSelection.length) {
    event.preventDefault();
    return;
  }
  event.dataTransfer?.setData(
    "application/x-exporter-figma-selection",
    JSON.stringify(figmaSelection),
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
};
el("import-selection").onclick = () => requestImport(figmaSelection);
window.addEventListener("import-figma-selection", (event) => {
  const { ids, x, y } = (event as CustomEvent).detail;
  if (
    Array.isArray(ids) &&
    ids.every((id) => typeof id === "string") &&
    Number.isFinite(x) &&
    Number.isFinite(y)
  )
    requestImport(ids, x, y);
});

el("figma-selection-card").onpointerdown = (event) => {
  if (event.button !== 0 || !figmaSelection.length) return;
  event.preventDefault();
  if (
    el<HTMLInputElement>("prototype-mode").checked ||
    !el<HTMLInputElement>("edit-mode").checked
  ) {
    status("Enable Edit generated layout to drop layers onto the viewport.");
    return;
  }
  const ids = [...figmaSelection],
    shield = document.createElement("div");
  shield.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:copy;touch-action:none";
  document.body.appendChild(shield);
  shield.setPointerCapture(event.pointerId);
  const stop = (e: PointerEvent) => {
    if (shield.hasPointerCapture(e.pointerId))
      shield.releasePointerCapture(e.pointerId);
    shield.remove();
    if (e.type !== "pointerup") return;
    const frame = el<HTMLIFrameElement>("frame"),
      rect = frame.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      return;
    const scale = rect.width / frame.offsetWidth;
    editor.dropSelection(
      ids,
      (e.clientX - rect.left) / scale,
      (e.clientY - rect.top) / scale,
    );
  };
  shield.addEventListener("pointerup", stop);
  shield.addEventListener("pointercancel", stop);
};

window.addEventListener("select-source-layers", (event) => {
  const detail = (event as CustomEvent).detail;
  sendToPlugin({ type: "select-source-layers", ...detail });
});
window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const message = event.data?.pluginMessage;
  if (message?.type === "source-selection-status")
    el("source-selection-status").textContent = message.message;
});
