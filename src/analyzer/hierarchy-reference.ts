import type { CoordinateReference, NodeModel } from "../ir/types";

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
export function isHierarchySquare(node: SceneNode): boolean {
  return (
    ["RECTANGLE", "FRAME", "GROUP"].includes(node.type) &&
    node.name
      .trim()
      .toLowerCase()
      .replace(/[ _-]+/g, " ") === "hierarchy square" &&
    near(node.width, 15) &&
    near(node.height, 15) &&
    "opacity" in node &&
    node.opacity === 0
  );
}

export function designRoot(node: SceneNode): SceneNode {
  if (!isHierarchySquare(node)) return node;
  let root: SceneNode | undefined;
  let parent = node.parent;
  while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
    if (
      parent.type === "FRAME" ||
      parent.type === "COMPONENT" ||
      parent.type === "INSTANCE"
    )
      root = parent;
    parent = parent.parent;
  }
  if (!root)
    throw new Error(
      "Place the hierarchy square inside the design frame before analyzing it.",
    );
  return root;
}

/** Convert canvas coordinates to the design frame's axes, including nested transforms. */
function localPoint(
  root: SceneNode,
  node: SceneNode,
): { x: number; y: number } {
  const [[a, c, tx], [b, d, ty]] = root.absoluteTransform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-8)
    throw new Error("Design frame has a non-invertible transform.");
  const x = node.absoluteTransform[0][2] - tx,
    y = node.absoluteTransform[1][2] - ty;
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}

export function findReference(
  root: SceneNode,
  warnings: string[],
): CoordinateReference | undefined {
  const markers: SceneNode[] = [];
  const visit = (node: SceneNode) => {
    if (isHierarchySquare(node)) {
      markers.push(node);
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(root);
  // Section markers belong to their own scope. Prefer this root's marker,
  // then a nested marker with the same origin and axes; equivalent markers are harmless.
  const aligned = markers.filter((marker) => {
    const point = localPoint(root, marker);
    const a = root.absoluteTransform,
      b = marker.absoluteTransform;
    return (
      Math.abs(point.x) <= 0.5 &&
      Math.abs(point.y) <= 0.5 &&
      [
        a[0][0] - b[0][0],
        a[0][1] - b[0][1],
        a[1][0] - b[1][0],
        a[1][1] - b[1][1],
      ].every((value) => Math.abs(value) <= 0.01)
    );
  });
  const preferred =
    aligned.find((marker) => marker.parent?.id === root.id) ?? aligned[0];
  if (!preferred && markers.length !== 1) {
    warnings.push(
      `${root.name}: ${markers.length ? "multiple hierarchy squares found" : "no valid hierarchy square found"}; using the frame origin. Expected one 15×15 rectangle named "hierarchy square" with 0% opacity.`,
    );
    return;
  }
  const marker = preferred ?? markers[0];
  const position = localPoint(root, marker);
  if (Math.abs(position.x) > 0.5 || Math.abs(position.y) > 0.5) {
    warnings.push(
      `${root.name}: hierarchy square is at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}), not the design's top-left corner; using the frame origin. Move the square to the design origin.`,
    );
    return;
  }
  const [[a, c], [b, d]] = root.absoluteTransform,
    m = marker.absoluteTransform;
  if (
    ![a - m[0][0], c - m[0][1], b - m[1][0], d - m[1][1]].every(
      (delta) => Math.abs(delta) <= 0.01,
    )
  ) {
    warnings.push(
      `${root.name}: hierarchy square is rotated or scaled relative to the design; using the frame origin.`,
    );
    return;
  }
  if (!near(root.width, 1920))
    warnings.push(
      `${root.name}: design width is ${root.width}px; expected 1920px. Actual dimensions are preserved.`,
    );
  return {
    markerId: marker.id,
    origin: {
      x: marker.absoluteTransform[0][2],
      y: marker.absoluteTransform[1][2],
    },
    frameOffset: position,
    width: root.width,
  };
}

export function recordPlacement(
  root: SceneNode,
  source: SceneNode,
  ir: NodeModel,
  reference: CoordinateReference,
): void {
  const position = localPoint(root, source);
  ir.placement = {
    x: Math.round((position.x - reference.frameOffset.x) * 1000) / 1000,
    y: Math.round((position.y - reference.frameOffset.y) * 1000) / 1000,
  };
}
