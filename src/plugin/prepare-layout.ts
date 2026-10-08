import { designRoot } from "../analyzer/hierarchy-reference";

/** Preserve resolved geometry while removing auto-layout, without detaching instances. */
export async function prepareLayout(scope: "selection" | "page") {
  if (scope === "page") await figma.currentPage.loadAsync();
  const roots =
    scope === "page"
      ? [...figma.currentPage.children]
      : figma.currentPage.selection.map(designRoot);
  if (!roots.length)
    throw new Error("Select a section or frame in Figma first.");
  const frames: FrameNode[] = [],
    seen = new Set<string>(),
    skipped: string[] = [];
  const visit = (node: SceneNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (
      node.locked ||
      ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node.type)
    ) {
      skipped.push(node.name);
      return;
    }
    if (node.type === "FRAME" && node.layoutMode !== "NONE") {
      if (
        node.children.some(
          (child) => child.locked || !("resizeWithoutConstraints" in child),
        )
      ) {
        skipped.push(node.name);
        return;
      }
      frames.push(node);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  roots
    .filter((root) => {
      let parent = root.parent;
      while (parent) {
        if (roots.some((candidate) => candidate.id === parent!.id))
          return false;
        parent = parent.parent;
      }
      return true;
    })
    .forEach((root) => {
      let parent = root.parent;
      while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
        if (
          parent.type === "INSTANCE" ||
          parent.type === "COMPONENT" ||
          parent.type === "COMPONENT_SET" ||
          ("locked" in parent && parent.locked)
        ) {
          skipped.push(root.name);
          return;
        }
        parent = parent.parent;
      }
      const directParent = root.parent;
      if (
        directParent &&
        "layoutMode" in directParent &&
        directParent.layoutMode !== "NONE" &&
        !roots.includes(directParent as SceneNode)
      ) {
        skipped.push(root.name + " (select its auto-layout parent)");
        return;
      }
      visit(root);
    });
  const geometry = new Map<
    SceneNode,
    { width: number; height: number; transform: Transform }
  >();
  for (const frame of frames)
    for (const node of [frame, ...frame.children]) {
      geometry.set(node, {
        width: node.width,
        height: node.height,
        transform: node.relativeTransform.map((row) => [...row]) as Transform,
      });
    }
  // Preflight fonts before any document mutation.
  const fonts = new Map<string, FontName>();
  for (const node of geometry.keys())
    if (node.type === "TEXT") {
      for (const font of node.getRangeAllFontNames(0, node.characters.length))
        fonts.set(JSON.stringify(font), font);
    }
  await Promise.all(
    [...fonts.values()].map((font) => figma.loadFontAsync(font)),
  );
  if (!frames.length) return { changed: 0, skipped };
  figma.commitUndo();
  try {
    for (const frame of frames) frame.layoutMode = "NONE";
    for (const [node, original] of geometry) {
      if (
        Math.abs(node.width - original.width) > 0.001 ||
        Math.abs(node.height - original.height) > 0.001
      )
        if ("resizeWithoutConstraints" in node)
          node.resizeWithoutConstraints(original.width, original.height);
      node.relativeTransform = original.transform;
    }
    for (const [node, original] of geometry) {
      const moved = node.relativeTransform.some((row, i) =>
        row.some(
          (value, j) => Math.abs(value - original.transform[i][j]) > 0.05,
        ),
      );
      if (
        moved ||
        Math.abs(node.width - original.width) > 0.05 ||
        Math.abs(node.height - original.height) > 0.05
      )
        throw new Error("Could not preserve geometry for " + node.name);
    }
  } catch (error) {
    figma.commitUndo();
    figma.triggerUndo();
    throw new Error(
      "Preparation failed; changes were undone. " + String(error),
    );
  }
  figma.commitUndo();
  return { changed: frames.length, skipped };
}
