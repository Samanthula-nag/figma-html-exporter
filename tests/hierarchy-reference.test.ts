import test from "node:test";
import assert from "node:assert/strict";
import {
  findReference,
  designRoot,
  isHierarchySquare,
} from "../src/analyzer/hierarchy-reference";
import { Analyzer } from "../src/analyzer/node-analyzer";
import { AnalysisProgress } from "../src/analyzer/progress";
import { analyze } from "../src/analyzer/document-analyzer";
import { buildProject } from "../src/exporter/project-builder";
import { captureSource } from "../src/preview/source-preview";

function fixture() {
  const base = {
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    rotation: 0,
  };
  const marker = {
    ...base,
    id: "marker",
    name: "hierarchy square",
    type: "RECTANGLE",
    width: 15,
    height: 15,
    opacity: 0,
    absoluteTransform: [
      [1, 0, 300],
      [0, 1, -200],
    ],
  };
  const content = {
    ...base,
    id: "content",
    name: "Content",
    type: "RECTANGLE",
    x: 125,
    y: 90,
    absoluteTransform: [
      [1, 0, 425],
      [0, 1, -110],
    ],
  };
  const header = {
    ...base,
    id: "header",
    name: "Header",
    type: "FRAME",
    layoutMode: "NONE",
    width: 1920,
    children: [marker, content],
    absoluteTransform: [
      [1, 0, 300],
      [0, 1, -200],
    ],
  };
  const footer = {
    ...base,
    id: "footer",
    name: "Footer",
    type: "RECTANGLE",
    y: 900,
    absoluteTransform: [
      [1, 0, 300],
      [0, 1, 700],
    ],
  };
  const root = {
    ...base,
    id: "root",
    name: "Design",
    type: "FRAME",
    layoutMode: "NONE",
    width: 1920,
    height: 1000,
    children: [header, footer],
    absoluteTransform: [
      [1, 0, 300],
      [0, 1, -200],
    ],
  };
  Object.assign(marker, { parent: header });
  Object.assign(content, { parent: header });
  Object.assign(header, { parent: root });
  Object.assign(footer, { parent: root });
  Object.assign(root, { parent: { type: "PAGE", id: "page" } });
  return {
    root: root as unknown as SceneNode,
    marker: marker as unknown as SceneNode,
    content: content as unknown as SceneNode,
    header: header as unknown as SceneNode,
  };
}

test("nested invisible marker selects the complete 1920px design, not just the header", () => {
  const { root, marker } = fixture();
  assert.ok(isHierarchySquare(marker));
  assert.equal(designRoot(marker), root);
  const warnings: string[] = [];
  const ref = findReference(root, warnings);
  assert.equal(ref?.width, 1920);
  assert.deepEqual(ref?.origin, { x: 300, y: -200 });
  assert.deepEqual(warnings, []);
});

test("marker never becomes output content or a progress work item", async () => {
  const { root } = fixture(),
    analyzer = new Analyzer();
  analyzer.coordinateRoot = root;
  analyzer.coordinateReference = findReference(root, []);
  const ir = await analyzer.node(root);
  const tracker = new AnalysisProgress([root]);
  assert.equal(tracker.total, 4);
  assert.equal(analyzer.count, 4);
  assert.deepEqual(
    ir.children[0].children.map((n) => n.id),
    ["content"],
  );
  assert.deepEqual(ir.children[0].children[0].placement, { x: 125, y: 90 });
  assert.equal(ir.children[0].children[0].style.left, "125px");
  assert.deepEqual(ir.children[1].placement, { x: 0, y: 900 });
});

test("ambiguous or misplaced markers warn rather than shifting the design", () => {
  const { root, marker, header } = fixture();
  const warnings: string[] = [];
  (marker as unknown as { absoluteTransform: number[][] }).absoluteTransform = [
    [1, 0, 310],
    [0, 1, -200],
  ];
  assert.equal(findReference(root, warnings), undefined);
  assert.match(warnings[0], /not the design's top-left/);
  (header as unknown as { children: SceneNode[] }).children.push({
    ...marker,
    id: "duplicate",
  } as SceneNode);
  assert.equal(findReference(root, warnings), undefined);
  assert.ok(warnings.some((w) => w.includes("multiple")));
});

test("coordinate map handles nested transforms instead of treating child x/y as canvas positions", async () => {
  const { root, marker, header, content } = fixture();
  (header as unknown as { absoluteTransform: number[][] }).absoluteTransform = [
    [1, 0, 340],
    [0, 1, -150],
  ];
  // Marker is at (-40,-50) in Header, while content remains at (125,90).
  Object.assign(marker, { x: -40, y: -50 });
  (content as unknown as { absoluteTransform: number[][] }).absoluteTransform =
    [
      [1, 0, 465],
      [0, 1, -60],
    ];
  const analyzer = new Analyzer();
  analyzer.coordinateRoot = root;
  analyzer.coordinateReference = findReference(root, []);
  const ir = await analyzer.node(root);
  assert.deepEqual(ir.children[0].children[0].placement, { x: 165, y: 140 });
  assert.equal(ir.children[0].children[0].style.left, "125px");
});

test("analyzing marker plus root exports one full page and a placement map", async () => {
  const { root, marker } = fixture();
  const old = (globalThis as any).figma;
  (globalThis as any).figma = {
    currentPage: { name: "Fixture", selection: [marker, root] },
  };
  try {
    const progress: number[] = [];
    const doc = await analyze("selection", (n, total) =>
      progress.push(n / total),
    );
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].root.children.length, 2);
    assert.equal(progress[progress.length - 1], 1);
    const result = buildProject(doc);
    assert.deepEqual(result.errors, []);
    assert.ok(result.files["design-map.json"]);
    assert.doesNotMatch(String(result.files["index.html"]), /hierarchy-square/);
  } finally {
    (globalThis as any).figma = old;
  }
});

test("source rendering and delivery happen before any layer-analysis progress", async () => {
  const { root } = fixture();
  const events: string[] = [];
  Object.assign(root, {
    exportAsync: async () => {
      events.push("capture");
      return new Uint8Array([1, 2]);
    },
  });
  const old = (globalThis as any).figma;
  (globalThis as any).figma = {
    currentPage: { name: "Visual fixture", selection: [root] },
  };
  try {
    await analyze(
      "selection",
      () => events.push("progress"),
      () => {},
      (source) => {
        assert.equal(source.width, 1920);
        events.push("source");
      },
    );
    assert.deepEqual(events.slice(0, 3), ["capture", "source", "progress"]);
  } finally {
    (globalThis as any).figma = old;
  }
});

test("source screenshot keeps full tall frame within memory bounds", async () => {
  const { root } = fixture();
  let settings: ExportSettingsImage | undefined;
  Object.assign(root, {
    height: 20000,
    exportAsync: async (options: ExportSettingsImage) => {
      settings = options;
      return new Uint8Array([1]);
    },
  });
  const source = await captureSource(root);
  assert.equal(settings?.format, "PNG");
  assert.equal(source.scale, 8192 / 20000);
  assert.equal(source.width, 1920);
  assert.equal(source.height, 20000);
});

test("failed visual capture is reported before analysis instead of silently proceeding", async () => {
  const { root } = fixture();
  Object.assign(root, {
    exportAsync: async () => {
      throw new Error("Render failed");
    },
  });
  const old = (globalThis as any).figma;
  let progressed = false;
  (globalThis as any).figma = {
    currentPage: { name: "Visual fixture", selection: [root] },
  };
  try {
    await assert.rejects(
      analyze(
        "selection",
        () => {
          progressed = true;
        },
        () => {},
        () => {},
      ),
      /Render failed/,
    );
    assert.equal(progressed, false);
  } finally {
    (globalThis as any).figma = old;
  }
});

test("analyzing a parent prefers its own reference over a nested section reference", () => {
  const { root, marker, header } = fixture();
  const direct = { ...marker, id: "hero-marker", parent: root } as SceneNode;
  (root as any).children.push(direct);
  (marker as any).absoluteTransform = [
    [1, 0, 420],
    [0, 1, -170],
  ];
  const warnings: string[] = [];
  assert.equal(findReference(root, warnings)?.markerId, "hero-marker");
  assert.deepEqual(warnings, []);
  (marker as any).absoluteTransform = [
    [1, 0, 300],
    [0, 1, -200],
  ];
  assert.equal(findReference(header, [])?.markerId, "marker");
});
test("equivalent origin markers and grouped invisible reference squares are accepted", () => {
  const { root, marker } = fixture();
  (marker as any).type = "GROUP";
  (root as any).children.push({ ...marker, id: "second", parent: root });
  const warnings: string[] = [];
  assert.ok(findReference(root, warnings));
  assert.deepEqual(warnings, []);
});
