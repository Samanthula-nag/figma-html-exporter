import test from "node:test";
import assert from "node:assert/strict";
import { Analyzer } from "../src/analyzer/node-analyzer";
import { fixWarnings } from "../src/plugin/fix-warnings";
import { describeWarning, IMAGE_EXPORT_KEY } from "../src/diagnostics/warnings";
function shape(id = "shape") {
  const data: Record<string, string> = {};
  return {
    id,
    name: "Repeated name",
    type: "RECTANGLE",
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    rotation: 0,
    visible: true,
    opacity: 1,
    strokes: [],
    effects: [],
    reactions: [],
    fills: [{ type: "GRADIENT_RADIAL", visible: true }],
    getPluginData: (key: string) => data[key] ?? "",
    setPluginData: (key: string, value: string) => {
      data[key] = value;
    },
    exportAsync: async () => new Uint8Array([1, 2, 3]),
  } as any;
}
function host(nodes: any[]) {
  const page: any = { id: "page", type: "PAGE" };
  const events: string[] = [];
  nodes.forEach((node) => (node.parent = page));
  (globalThis as any).figma = {
    currentPage: page,
    getNodeByIdAsync: async (id: string) => nodes.find((n) => n.id === id),
    commitUndo: () => events.push("commit"),
    triggerUndo: () => events.push("undo"),
    createRectangle: () => ({
      name: "",
      resize() {},
      set opacity(value: number) {},
      fills: [],
    }),
  };
  return events;
}
test("warnings carry exact node IDs even when names repeat; image fixes require opt-in", async () => {
  const a = shape("a"),
    b = shape("b");
  host([a, b]);
  const analyzer = new Analyzer();
  await analyzer.node(a);
  await analyzer.node(b);
  assert.deepEqual(
    analyzer.diagnostics.map((w) => w.nodeId),
    ["a", "b"],
  );
  assert.ok(analyzer.diagnostics.every((w) => w.fix === "image"));
  assert.equal((await fixWarnings(analyzer.diagnostics, false)).changed, 0);
  assert.equal((await fixWarnings(analyzer.diagnostics, true)).changed, 2);
  assert.equal(a.getPluginData(IMAGE_EXPORT_KEY), "png");
  const after = new Analyzer();
  const node = await after.node(a);
  assert.equal(node.tag, "img");
  assert.equal(after.warnings.length, 0);
  assert.equal(after.exportNotes.length, 1);
  assert.equal(a.fills[0].type, "GRADIENT_RADIAL");
});
test("locked layers, stale paint and failed render checks cannot be marked fixed", async () => {
  const a = shape("a"),
    b = shape("b"),
    c = shape("c");
  host([a, b, c]);
  a.locked = true;
  b.fills = [];
  c.exportAsync = async () => {
    throw Error("export failed");
  };
  const result = await fixWarnings(
    [a, b, c].map((node) => ({
      ...describeWarning("gradient geometry", node.id),
      fix: "image" as const,
    })),
    true,
  );
  assert.equal(result.changed, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal(c.getPluginData(IMAGE_EXPORT_KEY), "");
});
test("missing marker fixes are deduplicated and skip existing markers", async () => {
  const root: any = {
    id: "root",
    name: "Root",
    visible: true,
    type: "FRAME",
    width: 1920,
    height: 100,
    layoutMode: "NONE",
    children: [],
    findAll() {
      return this.children;
    },
    appendChild(node: any) {
      this.children.push(node);
    },
  };
  host([root]);
  const warning = {
    ...describeWarning("no valid hierarchy square", root.id),
    fix: "marker" as const,
  };
  assert.equal((await fixWarnings([warning, warning], false)).changed, 1);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].x, 0);
  assert.equal(root.children[0].y, 0);
  assert.equal((await fixWarnings([warning], false)).changed, 0);
});
test("manual and informational warnings never advertise a source mutation", () => {
  for (const message of [
    "Font Inter: binary is not exposed",
    "Hero: freeform coordinates retained",
    "Text: mixed text styles use the first segment's style.",
    "Mask: mask semantics are unsupported.",
  ])
    assert.equal(describeWarning(message).fix, undefined);
});
