import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { complexFixture } from "./fixture";
import { Names, escape, safeUrl } from "../src/utils/naming";
import { buildProject } from "../src/exporter/project-builder";
import { zip } from "../src/exporter/zip-builder";
import { Analyzer } from "../src/analyzer/node-analyzer";
import { AssetManager } from "../src/assets/asset-manager";
import { validate } from "../src/validation/export-validator";
import { validateCss } from "../src/validation/css-validator";
import { validateHtml } from "../src/validation/html-validator";
import { interaction } from "../src/analyzer/interaction-analyzer";
import { AnalysisProgress } from "../src/analyzer/progress";
test("analysis progress counts completed subtrees once and excludes hidden layers", () => {
  const child = mock({ id: "child" });
  const group = mock({
    id: "group",
    children: [child, mock({ id: "hidden", visible: false })],
  });
  const root = mock({ id: "root", children: [group, mock({ id: "sibling" })] });
  const tracker = new AnalysisProgress([root]);
  assert.equal(tracker.total, 4);
  assert.equal(tracker.count, 0);
  tracker.complete("child");
  assert.equal(tracker.count, 1);
  tracker.complete("group");
  assert.equal(tracker.count, 2);
  tracker.complete("root");
  assert.equal(tracker.count, 4);
  tracker.complete("root");
  assert.equal(tracker.count, 4);
});
test("class registry avoids collisions, handles unsafe and numeric names", () => {
  const names = new Names();
  assert.equal(names.get("Hero Section"), "hero-section");
  assert.equal(names.get("Hero Section"), "hero-section-2");
  assert.equal(names.get("hero-section-2"), "hero-section-2-2");
  assert.match(names.get("123"), /^[a-z]/);
});
test("escapes HTML and rejects active or obfuscated URL schemes", () => {
  assert.equal(escape('<script>"'), "&lt;script&gt;&quot;");
  assert.equal(safeUrl("javascript:alert(1)"), false);
  assert.equal(safeUrl("https:\n//evil.test"), false);
  assert.equal(safeUrl("https://example.com"), true);
});
test("complex IR generates shared styles, relative links, assets and required JS", () => {
  const doc = complexFixture(),
    result = buildProject(doc);
  assert.deepEqual(result.errors, []);
  assert.match(String(result.files["index.html"]), /href="pages\/about.html"/);
  assert.match(
    String(result.files["pages/about.html"]),
    /href="..\/css\/styles.css"/,
  );
  assert.match(String(result.files["css/styles.css"]), /linear-gradient/);
  assert.match(String(result.files["css/responsive.css"]), /@media/);
  assert.match(String(result.files["js/script.js"]), /history.back/);
});
test("static document omits JavaScript and unresolved destinations are reported", () => {
  const doc = complexFixture();
  doc.pages = doc.pages.slice(0, 1);
  const result = buildProject(doc);
  assert.equal(result.files["js/script.js"], undefined);
  assert.ok(doc.warnings.some((w) => w.includes("navigation omitted")));
  assert.doesNotMatch(String(result.files["index.html"]), /href="pages/);
});
test("validator detects missing assets and conflicting classes", () => {
  const doc = complexFixture(),
    { files } = buildProject(doc);
  delete files[doc.assets[0].path];
  doc.pages[1].root.className = doc.pages[0].root.className;
  const errors = validate(doc, files);
  assert.ok(errors.some((e) => e.includes("Missing asset")));
  assert.ok(errors.some((e) => e.includes("Conflicting")));
});
test("HTML and CSS validators reject malformed syntax", () => {
  assert.ok(validateHtml('<html><body id="a"><p id="a"></body>').length);
  assert.ok(validateCss('a { color: "unterminated; }').length);
});
test("ZIP round trip preserves nested paths and asset bytes", () => {
  const { files } = buildProject(complexFixture()),
    bytes = zip(files),
    archive = unzipSync(bytes);
  assert.equal(strFromU8(archive["website/index.html"]), files["index.html"]);
  assert.deepEqual(
    archive["website/assets/svg/landscape.svg"],
    files["assets/svg/landscape.svg"],
  );
  assert.throws(() => zip({ "../escape": "bad" }));
  mkdirSync("test-output", { recursive: true });
  writeFileSync("test-output/website.zip", bytes);
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(`test-output/website/${path}`), { recursive: true });
    writeFileSync(`test-output/website/${path}`, value);
  }
});
function mock(overrides: Record<string, unknown> = {}): SceneNode {
  return {
    id: "1",
    name: "Hero",
    type: "FRAME",
    width: 600,
    height: 200,
    x: 0,
    y: 0,
    visible: true,
    children: [],
    layoutMode: "VERTICAL",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "HUG",
    paddingTop: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    paddingRight: 20,
    itemSpacing: 16,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "CENTER",
    layoutWrap: "NO_WRAP",
    fills: [],
    strokes: [],
    effects: [],
    reactions: [],
    ...overrides,
  } as unknown as SceneNode;
}
test("reader produces Figma-independent IR and isolates failed nodes", async () => {
  const analyzer = new Analyzer();
  const ir = await analyzer.node(
    mock({
      children: [
        mock({
          id: "2",
          type: "VECTOR",
          name: "Broken icon",
          exportAsync: async () => {
            throw Error("export unavailable");
          },
        }),
      ],
    }),
  );
  assert.equal(ir.layout, "column");
  assert.equal(ir.style.display, "flex");
  assert.equal(ir.children.length, 1);
  assert.ok(analyzer.warnings.some((w) => w.includes("fallback failed")));
  assert.doesNotThrow(() => JSON.stringify(ir));
});
test("asset mapping deduplicates identical bytes", async () => {
  const assets = new AssetManager();
  const a = await assets.export(
    mock({ exportAsync: async () => new Uint8Array([1, 2, 3]) }),
    "PNG",
  );
  const b = await assets.export(
    mock({
      id: "2",
      name: "Duplicate",
      exportAsync: async () => new Uint8Array([1, 2, 3]),
    }),
    "PNG",
  );
  assert.equal(a, b);
  assert.equal(assets.assets.length, 2);
});
test("grid tracks and freeform positions use actual layout evidence", async () => {
  const analyzer = new Analyzer();
  const grid = await analyzer.node(
    mock({
      layoutMode: "GRID",
      gridColumnSizes: [
        { type: "FIXED", value: 100 },
        { type: "FLEX", value: 2 },
      ],
      gridRowSizes: [{ type: "HUG" }],
      gridColumnGap: 12,
      gridRowGap: 8,
    }),
  );
  assert.equal(grid.style["grid-template-columns"], "100px minmax(0, 2fr)");
  const free = await analyzer.node(
    mock({
      layoutMode: "NONE",
      children: [mock({ id: "child", x: 20, y: 30 })],
    }),
  );
  assert.equal(free.children[0].style.left, "20px");
  assert.ok(analyzer.warnings.some((w) => w.includes("freeform")));
});

test("rendered assets do not double-apply paint or lose layout sizing", async () => {
  const analyzer = new Analyzer();
  const ir = await analyzer.node(
    mock({
      type: "VECTOR",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      opacity: 0.5,
      exportAsync: async () => new Uint8Array([1]),
    }),
  );
  assert.equal(ir.style.background, undefined);
  assert.equal(ir.style.opacity, undefined);
  assert.equal(ir.style.width, "600px");
});

test("prototype handling rejects unsafe URLs and unsupported triggers", () => {
  const warnings: string[] = [];
  assert.equal(
    interaction(
      mock({
        reactions: [
          {
            trigger: { type: "ON_CLICK" },
            actions: [{ type: "URL", url: "javascript:alert(1)" }],
          },
        ],
      }),
      warnings,
    ),
    undefined,
  );
  assert.ok(warnings.length);
  const link = interaction(
    mock({
      reactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "URL", url: "https://example.com" }],
        },
      ],
    }),
    [],
  );
  assert.equal(link?.type, "url");
  const unsupported: string[] = [];
  assert.equal(
    interaction(
      mock({
        reactions: [
          { trigger: { type: "ON_HOVER" }, actions: [{ type: "BACK" }] },
        ],
      }),
      unsupported,
    ),
    undefined,
  );
  assert.ok(unsupported.length);
});

test("nested interactive layers never produce nested buttons or links", () => {
  const doc = complexFixture();
  doc.pages[0].root.tag = "button";
  const { files, errors } = buildProject(doc);
  assert.deepEqual(errors, []);
  const body = String(files["index.html"]).split("<body>")[1];
  assert.equal((body.match(/<button\b/g) || []).length, 1);
  assert.equal((body.match(/<a\b/g) || []).length, 0);
});

test("preserved geometry keeps resolved auto-layout widths, positions and transforms", async () => {
  const child = mock({
    id: "measured",
    type: "RECTANGLE",
    children: undefined,
    width: 120,
    height: 40,
    x: 80,
    y: 20,
    layoutSizingHorizontal: "FILL",
    relativeTransform: [
      [0, -1, 80],
      [1, 0, 20],
    ],
  });
  // Leaf nodes do not expose a children property in the actual API.
  delete (child as any).children;
  const parent = mock({
    id: "source",
    width: 1920,
    height: 200,
    layoutMode: "HORIZONTAL",
    children: [child],
  });
  (child as any).parent = parent;
  const analyzer = new Analyzer();
  analyzer.preserveGeometry = true;
  const ir = await analyzer.node(parent);
  assert.equal(ir.style.width, "1920px");
  assert.equal(ir.layout, "free");
  assert.equal(ir.responsive, false);
  assert.equal(ir.style.padding, "0");
  assert.equal(ir.style["flex-direction"], undefined);
  assert.equal(ir.children[0].style.width, "120px");
  assert.equal(ir.children[0].style.left, "80px");
  assert.equal(ir.children[0].style.transform, "matrix(0,1,-1,0,0,0)");
  assert.equal(ir.children[0].style["transform-origin"], "0 0");
});

test("SVG paint does not report unused CSS approximation and fixed geometry is informational", async () => {
  const vector = mock({
    id: "art",
    type: "BOOLEAN_OPERATION",
    name: "Container 381",
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        gradientStops: [],
      },
    ],
    exportAsync: async () => new Uint8Array([1]),
  });
  const analyzer = new Analyzer();
  analyzer.preserveGeometry = true;
  const ir = await analyzer.node(
    mock({ name: "Container 371", layoutMode: "NONE", children: [vector] }),
  );
  assert.ok(ir.children[0].asset?.endsWith(".svg"));
  assert.ok(
    !analyzer.warnings.some((w) =>
      /gradient geometry|freeform coordinates/.test(w),
    ),
  );
  assert.ok(analyzer.exportNotes.some((note) => note.includes("exported SVG")));
  assert.ok(
    analyzer.exportNotes.some((note) => note.includes("positions preserved")),
  );
});
