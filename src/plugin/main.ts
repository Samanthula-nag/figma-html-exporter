import { createWindowControls } from "./window-controls";
import { LiveSync } from "./live-sync";
import { fixWarnings } from "./fix-warnings";
import type { ExportWarning } from "../diagnostics/warnings";
import { prepareLayout } from "./prepare-layout";
import { analyze } from "../analyzer/document-analyzer";
import { buildProject } from "../exporter/project-builder";
import { BUILD_ID } from "./version";
import { importSelection } from "../analyzer/import-selection";
figma.showUI(__html__, { width: 1400, height: 900, themeColors: true });
const windowControls = createWindowControls(
  figma.ui,
  () => figma.viewport.zoom,
);
let busy = false;
const sourceIds = new Set<string>();
let selectionRequest = 0;
function rememberSources(nodes: import("../ir/types").NodeModel[]) {
  for (const node of nodes) {
    if (node.sourceId) sourceIds.add(node.sourceId);
    rememberSources(node.children);
  }
}
let analyzedWarnings: ExportWarning[] = [];
let lastAnalysis:
  { pageId: string; rootIds: string[]; warnings: ExportWarning[] } | undefined;
let sourceScope: "selection" | "page" = "selection";
let preserveLiveGeometry = true;
let watchedPage: PageNode | undefined;
const syncStatus = (message: string) =>
  figma.ui.postMessage({ type: "sync-status", message });
const live = new LiveSync(
  () => busy,
  async (current) => {
    if (!lastAnalysis) return;
    if (figma.currentPage.id !== lastAnalysis.pageId) {
      syncStatus("Live sync waiting: return to the analyzed Figma page.");
      return;
    }
    busy = true;
    try {
      syncStatus("Syncing Figma changes…");
      const roots: SceneNode[] = [];
      if (sourceScope === "selection")
        for (const id of lastAnalysis.rootIds) {
          const node = await figma.getNodeByIdAsync(id);
          if (!node || !("visible" in node) || !node.visible) continue;
          let parent: BaseNode | null = node;
          while (parent && parent.type !== "PAGE") parent = parent.parent;
          if (parent?.id === lastAnalysis.pageId) roots.push(node as SceneNode);
        }
      if (
        (sourceScope === "selection" && !roots.length) ||
        (sourceScope === "page" &&
          !figma.currentPage.children.some(
            (node) => node.visible && node.type !== "SLICE",
          ))
      ) {
        if (current()) figma.ui.postMessage({ type: "sync-empty" });
        return;
      }
      const doc = await analyze(
        sourceScope,
        () => {},
        () => {},
        undefined,
        preserveLiveGeometry,
        sourceScope === "selection" ? roots : undefined,
      );
      const project = buildProject(doc);
      if (!current()) return;
      rememberSources(doc.pages.map((page) => page.root));
      analyzedWarnings = doc.diagnostics ?? [];
      lastAnalysis.warnings = analyzedWarnings;
      figma.ui.postMessage({ type: "result", doc, ...project, live: true });
      syncStatus("Live sync on · updated from Figma.");
    } catch (error) {
      if (current()) syncStatus("Live sync failed: " + String(error));
    } finally {
      busy = false;
    }
  },
);
const changed = () => live.changed();
function watchSource() {
  if (watchedPage === figma.currentPage) return;
  watchedPage?.off?.("nodechange", changed);
  watchedPage = figma.currentPage;
  watchedPage.on?.("nodechange", changed);
  syncStatus("Live sync ready · follows the analyzed frames.");
}
figma.on("stylechange", changed);
figma.on("currentpagechange", changed);
figma.on("close", () => {
  live.stop();
  watchedPage?.off?.("nodechange", changed);
});
const sendSelection = () =>
  figma.ui.postMessage({
    type: "figma-selection",
    layers: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
    })),
  });
figma.on("selectionchange", sendSelection);
figma.ui.onmessage = async (message: unknown) => {
  if (windowControls.handle(message)) return;
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "select-source-layers"
  ) {
    const request = message as { ids?: unknown; unmapped?: number };
    if (!Array.isArray(request.ids)) return;
    const sequence = ++selectionRequest;
    const page = figma.currentPage;
    const nodes: SceneNode[] = [];
    let missing = request.unmapped ?? 0;
    for (const id of new Set(request.ids)) {
      if (typeof id !== "string" || !sourceIds.has(id)) {
        missing++;
        continue;
      }
      const node = await figma.getNodeByIdAsync(id).catch(() => null);
      let ancestor = node;
      while (ancestor && ancestor.type !== "PAGE") ancestor = ancestor.parent;
      if (node && "visible" in node && ancestor?.id === page.id)
        nodes.push(node as SceneNode);
      else missing++;
    }
    if (sequence !== selectionRequest || figma.currentPage !== page) return;
    page.selection = nodes;
    figma.ui.postMessage({
      type: "source-selection-status",
      message:
        `${nodes.length} matching Figma layer(s) selected.` +
        (missing
          ? ` ${missing} layer(s) have no available original (plugin copy, deleted layer, or another page).`
          : ""),
    });
    return;
  }
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "set-live-sync"
  ) {
    const enabled = "enabled" in message && message.enabled === true;
    live.setEnabled(enabled);
    syncStatus(
      enabled
        ? "Live sync on · checking Figma…"
        : "Live sync paused · plugin edits are kept.",
    );
    return;
  }
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    ["fix-warnings", "focus-warning"].includes(String(message.type))
  ) {
    if (busy) {
      figma.ui.postMessage({
        type: "warning-action",
        message: "Wait for the current operation to finish.",
      });
      return;
    }
    busy = true;
    try {
      if (message.type === "fix-warnings") {
        if (!lastAnalysis || lastAnalysis.pageId !== figma.currentPage.id)
          throw new Error(
            "Analyze the current Figma page before repairing it.",
          );
        const roots: SceneNode[] = [];
        for (const id of lastAnalysis.rootIds) {
          const node = await figma.getNodeByIdAsync(id);
          if (!node || !("visible" in node) || !node.visible)
            throw new Error(
              "An analyzed frame was deleted or hidden. Analyze the selection again.",
            );
          let parent: BaseNode | null = node;
          while (parent && parent.type !== "PAGE") parent = parent.parent;
          if (parent?.id !== lastAnalysis.pageId)
            throw new Error(
              "An analyzed frame moved to another page. Analyze again.",
            );
          roots.push(node as SceneNode);
        }
        figma.ui.postMessage({
          type: "stage",
          message:
            "Checking supported repairs in the original analyzed frames…",
        });
        const repair = await fixWarnings(
          lastAnalysis.warnings,
          "includeImages" in message && message.includeImages === true,
        );
        const doc = await analyze(
          "selection",
          (count, total) =>
            figma.ui.postMessage({ type: "progress", count, total }),
          (message) => figma.ui.postMessage({ type: "stage", message }),
          undefined,
          true,
          roots,
        );
        const project = buildProject(doc);
        rememberSources(doc.pages.map((page) => page.root));
        analyzedWarnings = doc.diagnostics ?? [];
        lastAnalysis = {
          pageId: figma.currentPage.id,
          rootIds: doc.pages.map((page) => page.id),
          warnings: analyzedWarnings,
        };
        figma.ui.postMessage({ type: "result", doc, ...project, repair });
      } else if (
        "nodeId" in message &&
        typeof message.nodeId === "string" &&
        analyzedWarnings.some((w) => w.nodeId === message.nodeId)
      ) {
        const node = await figma.getNodeByIdAsync(message.nodeId);
        if (!node || !("visible" in node))
          throw new Error("Source layer no longer exists.");
        let ancestor: BaseNode | null = node;
        while (ancestor && ancestor.type !== "PAGE") ancestor = ancestor.parent;
        if (ancestor?.id !== figma.currentPage.id)
          throw new Error("Return to the analyzed Figma page first.");
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node]);
        figma.ui.postMessage({
          type: "warning-action",
          message: "Selected in Figma: " + node.name,
        });
      }
    } catch (error) {
      figma.ui.postMessage({ type: "warning-action", message: String(error) });
    } finally {
      busy = false;
    }
    return;
  }
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "prepare-layout"
  ) {
    if (busy) {
      figma.ui.postMessage({
        type: "prepare-error",
        message: "Wait for the current operation to finish.",
      });
      return;
    }
    if (
      !("scope" in message) ||
      !["selection", "page"].includes(String(message.scope))
    )
      return;
    busy = true;
    try {
      const result = await prepareLayout(message.scope as "selection" | "page");
      figma.ui.postMessage({ type: "prepare-result", ...result });
    } catch (error) {
      figma.ui.postMessage({ type: "prepare-error", message: String(error) });
    } finally {
      busy = false;
    }
    return;
  }

  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "import-selection"
  ) {
    if (busy) {
      figma.ui.postMessage({
        type: "import-error",
        message: "Wait for the current analysis or import to finish.",
      });
      return;
    }
    busy = true;
    try {
      const ids =
        "ids" in message && Array.isArray(message.ids)
          ? message.ids.filter((id): id is string => typeof id === "string")
          : [];
      const selection = await importSelection(
        ids,
        !("preserveGeometry" in message) || message.preserveGeometry !== false,
      );
      rememberSources(selection.nodes);
      analyzedWarnings = [
        ...analyzedWarnings,
        ...(selection.diagnostics ?? []),
      ];
      figma.ui.postMessage({
        type: "import-result",
        selection,
        requestId: "requestId" in message ? message.requestId : undefined,
      });
    } catch (error) {
      figma.ui.postMessage({ type: "import-error", message: String(error) });
    } finally {
      busy = false;
    }
    return;
  }
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "resize-window"
  ) {
    if (
      "width" in message &&
      "height" in message &&
      typeof message.width === "number" &&
      typeof message.height === "number" &&
      Number.isFinite(message.width) &&
      Number.isFinite(message.height)
    ) {
      figma.ui.resize(
        Math.round(Math.max(640, Math.min(2560, message.width))),
        Math.round(Math.max(420, Math.min(1600, message.height))),
      );
    }
    return;
  }
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "ping"
  ) {
    figma.ui.postMessage({
      type: "pong",
      build: BUILD_ID,
      busy,
      windowControls: windowControls.capabilities(),
    });
    sendSelection();
    return;
  }
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== "analyze" ||
    !("scope" in message) ||
    !["page", "selection"].includes(String(message.scope))
  )
    return;
  if (busy) {
    figma.ui.postMessage({
      type: "stage",
      message: "An analysis is already running. Waiting for its next update…",
    });
    return;
  }
  busy = true;
  try {
    figma.ui.postMessage({
      type: "stage",
      message: "Figma connected — preparing analysis…",
    });
    const doc = await analyze(
      message.scope as "page" | "selection",
      (count, total) =>
        figma.ui.postMessage({ type: "progress", count, total }),
      (message) => figma.ui.postMessage({ type: "stage", message }),
      undefined,
      !("preserveGeometry" in message) || message.preserveGeometry !== false,
    );
    figma.ui.postMessage({
      type: "stage",
      message: "Analysis 100% — generating and validating website…",
    });
    rememberSources(doc.pages.map((page) => page.root));
    analyzedWarnings = doc.diagnostics ?? [];
    lastAnalysis = {
      pageId: figma.currentPage.id,
      rootIds: doc.pages.map((page) => page.id),
      warnings: analyzedWarnings,
    };
    sourceScope = message.scope as "selection" | "page";
    preserveLiveGeometry = doc.preserveGeometry === true;
    watchSource();
    const project = buildProject(doc);
    figma.ui.postMessage({ type: "result", doc, ...project });
  } catch (error) {
    figma.ui.postMessage({ type: "error", message: String(error) });
  } finally {
    busy = false;
  }
};
