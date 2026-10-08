import { describeWarning } from "../diagnostics/warnings";
import type { DocumentModel } from "../ir/types";
import { Names } from "../utils/naming";
import { Analyzer } from "./node-analyzer";
import { AnalysisProgress } from "./progress";
import { withTimeout } from "../utils/timeout";
import { designRoot, findReference } from "./hierarchy-reference";
import { captureSource, type SourcePreview } from "../preview/source-preview";
export async function analyze(
  scope: "selection" | "page",
  progress: (count: number, total: number) => void,
  stage: (message: string) => void = () => {},
  sourcePreview?: (preview: SourcePreview) => void,
  preserveGeometry = false,
  sourceRoots?: readonly SceneNode[],
): Promise<DocumentModel> {
  if (scope === "page") {
    stage("Loading the current Figma page…");
    await withTimeout(
      figma.currentPage.loadAsync(),
      30000,
      "Loading the current page",
    );
  }
  stage("Finding design frames…");
  const roots = (
    sourceRoots ??
    (scope === "selection"
      ? figma.currentPage.selection
      : figma.currentPage.children)
  )
    .map((n) => (scope === "selection" ? designRoot(n) : n))
    .filter((n) => n.visible && (scope === "selection" || n.type !== "SLICE"));
  const selected = new Set(roots.map((n) => n.id));
  const unique = roots.filter((n, index) => {
    if (roots.findIndex((root) => root.id === n.id) !== index) return false;
    let p = n.parent;
    while (p) {
      if (selected.has(p.id)) return false;
      p = p.parent;
    }
    return true;
  });
  if (!unique.length)
    throw new Error("Select at least one visible frame or use Analyze Page.");
  if (sourcePreview) {
    for (let index = 0; index < unique.length; index++) {
      stage(
        `Capturing Figma design ${index + 1} of ${unique.length}: ${unique[index].name}…`,
      );
      sourcePreview(await captureSource(unique[index]));
    }
    // Yield so the UI can show the rendered source before traversal begins.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  stage(
    sourcePreview
      ? "Figma reference captured — reading layer geometry…"
      : "Reading layer geometry…",
  );
  const tracker = new AnalysisProgress(unique);
  progress(0, tracker.total);
  const analyzer = new Analyzer(
      (_count, node) => {
        tracker.complete(node.id);
        progress(tracker.count, tracker.total);
      },
      (node) => stage(`Analyzing layer: ${node.name}…`),
    ),
    names = new Names();
  analyzer.preserveGeometry = preserveGeometry;
  const pages = [];
  for (const root of unique) {
    const warningStart = analyzer.warnings.length;
    const reference = findReference(root, analyzer.warnings);
    analyzer.diagnostics.push(
      ...analyzer.warnings.slice(warningStart).map((message) => {
        const diagnostic = describeWarning(message, root.id);
        if (root.type === "FRAME" && /no valid hierarchy square/.test(message))
          diagnostic.fix = "marker";
        return diagnostic;
      }),
    );
    analyzer.coordinateRoot = root;
    analyzer.coordinateReference = reference;
    stage(
      reference
        ? `Hierarchy square found — analyzing the full ${root.width}px design…`
        : `Analyzing ${root.name} using its frame origin…`,
    );
    const ir = await analyzer.node(root);
    ir.style.width = preserveGeometry ? root.width + "px" : "100%";
    if (preserveGeometry) {
      delete ir.style.transform;
      ir.style["transform-origin"] = "0 0";
    }
    ir.style["max-width"] = `${root.width}px`;
    ir.style["margin-inline"] = "auto";
    pages.push({
      id: root.id,
      name: root.name,
      path: pages.length ? `pages/${names.get(root.name)}.html` : "index.html",
      root: ir,
      reference,
    });
  }
  for (const font of analyzer.fonts)
    analyzer.warnings.push(
      `Font ${font}: binary is not exposed by the Plugin API; install or supply a licensed web font.`,
    );
  return {
    source: figma.currentPage.name,
    preserveGeometry,
    diagnostics: analyzer.diagnostics,
    exportNotes: analyzer.exportNotes,
    pages,
    assets: analyzer.assets.assets,
    fonts: [...analyzer.fonts],
    warnings: analyzer.warnings,
  };
}
