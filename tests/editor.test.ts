import test from "node:test";
import assert from "node:assert/strict";
import { EditorSession } from "../src/editor/session";
import { complexFixture } from "./fixture";
import { buildProject } from "../src/exporter/project-builder";
import { walk } from "../src/generators/html";
import { zip } from "../src/exporter/zip-builder";
import { strFromU8, unzipSync } from "fflate";

test("corrections persist through generation and ZIP without changing original IR", () => {
  const original = complexFixture(),
    session = new EditorSession(original),
    heading = walk(original.pages[0].root).find((n) => n.tag === "h1")!;
  session.move(heading.id, 40, -12);
  session.apply(heading.id, {
    style: { width: "900px", "white-space": "nowrap" },
    text: "Corrected <heading>",
  });
  const result = buildProject(session.doc);
  assert.deepEqual(result.errors, []);
  const files = unzipSync(zip(result.files)),
    css = strFromU8(files["website/css/styles.css"]),
    html = strFromU8(files["website/index.html"]);
  assert.match(css, /translate: 40px -12px/);
  assert.match(css, /width: 900px/);
  assert.match(html, /Corrected &lt;heading&gt;/);
  assert.notEqual(heading.text, "Corrected <heading>");
  assert.equal(heading.style.translate, undefined);
  assert.doesNotMatch(html, /exporterEditor|nonce=|Drag to resize/);
});
test("undo redo and reset restore edits across nodes without removing child corrections", () => {
  const session = new EditorSession(complexFixture()),
    root = session.doc.pages[0].root,
    child = root.children[0];
  session.move(child.id, 10, 20);
  session.move(root.id, 30, 40);
  session.reset(root.id);
  assert.equal(session.find(root.id)?.style.translate, undefined);
  assert.equal(session.find(child.id)?.style.translate, "10px 20px");
  session.undo();
  assert.equal(session.find(root.id)?.style.translate, "30px 40px");
  session.redo();
  assert.equal(session.find(root.id)?.style.translate, undefined);
  session.undo();
  session.move(child.id, 5, 5);
  assert.equal(session.canRedo, false);
});
test("changing a container to a row releases its absolute-positioned children", () => {
  const doc = complexFixture();
  const root = doc.pages[0].root;
  root.children[0].style.position = "absolute";
  root.children[0].style.left = "200px";
  const session = new EditorSession(doc);
  session.apply(root.id, {
    style: { display: "flex", "flex-direction": "row" },
  });
  assert.equal(session.find(root.id)?.layout, "row");
  assert.equal(session.find(root.children[0].id)?.style.position, undefined);
  session.undo();
  assert.equal(session.find(root.children[0].id)?.style.left, "200px");
});
test("non-finite moves and CSS injection are rejected without adding history", () => {
  const session = new EditorSession(complexFixture()),
    id = session.doc.pages[0].root.id;
  assert.throws(() => session.move(id, NaN, 0));
  assert.throws(() =>
    session.apply(id, { style: { width: "10px; color:red" } }),
  );
  assert.throws(() => session.apply(id, { text: "replace container" }));
  assert.equal(session.canUndo, false);
});

test("multi-selection movement is atomic and does not move descendants twice", () => {
  const session = new EditorSession(complexFixture());
  const root = session.doc.pages[0].root,
    child = root.children[0];
  session.moveMany([root.id, child.id], 20, 30);
  assert.equal(session.find(root.id)?.style.translate, "20px 30px");
  assert.equal(session.find(child.id)?.style.translate, undefined);
  session.undo();
  assert.equal(session.find(root.id)?.style.translate, undefined);
  assert.equal(session.canUndo, false);
  session.redo();
  assert.equal(session.find(root.id)?.style.translate, "20px 30px");
});

test("batch edits roll back completely on failure and undo all selected layers together", () => {
  const session = new EditorSession(complexFixture());
  const [first, second] = session.doc.pages[0].root.children;
  const originalColor = first.style.color;
  assert.throws(() =>
    session.applyMany([first.id, "missing"], { style: { color: "red" } }),
  );
  assert.equal(session.find(first.id)?.style.color, originalColor);
  assert.equal(session.canUndo, false);
  session.applyMany([first.id, second.id], { style: { color: "#123456" } });
  session.undo();
  assert.notEqual(session.find(first.id)?.style.color, "#123456");
  assert.notEqual(session.find(second.id)?.style.color, "#123456");
  assert.equal(session.canUndo, false);
});

test("automatic responsive generation covers all pages and is undoable", () => {
  const session = new EditorSession(complexFixture());
  session.autoResponsive();
  const output = buildProject(session.doc);
  assert.deepEqual(output.errors, []);
  const css = String(output.files["css/responsive.css"]);
  assert.match(css, /max-width: 1024px/);
  assert.match(css, /max-width: 600px/);
  for (const page of session.doc.pages)
    assert.ok(css.includes(page.root.className));
  session.undo();
  assert.equal(session.doc.autoResponsive, undefined);
  assert.doesNotMatch(
    String(buildProject(session.doc).files["css/responsive.css"]),
    /Automatic responsive reflow/,
  );
});

test("delete removes complete selected subtrees and undo restores them", () => {
  const session = new EditorSession(complexFixture());
  const root = session.doc.pages[0].root,
    hero = walk(root).find((node) => node.name === "Hero")!;
  const children = walk(hero).map((node) => node.id);
  session.deleteMany(children);
  for (const id of children) assert.equal(session.find(id), undefined);
  assert.deepEqual(buildProject(session.doc).errors, []);
  session.undo();
  for (const id of children) assert.ok(session.find(id));
  assert.throws(() => session.deleteMany([root.id]));
});

test("import preserves relative placements, avoids asset/class collisions and undoes atomically", () => {
  const doc = complexFixture(),
    session = new EditorSession(doc);
  const source = walk(doc.pages[0].root).find((node) => node.asset)!;
  const first = { ...source, placement: { x: 100, y: 200 } },
    second = {
      ...source,
      id: "copy",
      className: source.className + "-copy",
      placement: { x: 140, y: 250 },
    };
  const selection = {
    nodes: [first, second],
    assets: doc.assets,
    fonts: doc.fonts,
    warnings: [],
  };
  const ids = session.importInto("index.html", selection, 20, 30);
  assert.equal(session.find(ids[0])?.style.left, "20px");
  assert.equal(session.find(ids[1])?.style.left, "60px");
  assert.equal(session.find(ids[1])?.style.top, "80px");
  assert.notEqual(session.find(ids[0])?.asset, source.asset);
  assert.deepEqual(buildProject(session.doc).errors, []);
  // Real analyzer assigns distinct class names even when names repeat.
  assert.equal(session.doc.assets.length, doc.assets.length * 2);
  session.undo();
  assert.equal(session.find(ids[0]), undefined);
  assert.equal(session.doc.assets.length, doc.assets.length);
  session.redo();
  assert.ok(session.find(ids[0]));
});

test("duplicate copies subtrees once, preserves assets and has independent IDs across undo", () => {
  const session = new EditorSession(complexFixture());
  const parent = session.doc.pages[0].root.children.find(
    (n) => n.children.length,
  )!;
  const copies = session.duplicateMany([parent.id, parent.children[0].id]);
  assert.equal(copies.length, 1);
  const copy = session.find(copies[0])!;
  assert.equal(copy.children.length, parent.children.length);
  assert.notEqual(copy.children[0].id, parent.children[0].id);
  assert.notEqual(copy.children[0].className, parent.children[0].className);
  assert.deepEqual(buildProject(session.doc).errors, []);
  session.undo();
  assert.equal(session.find(copies[0]), undefined);
  session.redo();
  assert.ok(session.find(copies[0]));
  const next = session.duplicateMany([parent.id]);
  assert.notEqual(copies[0], next[0]);
});
test("stacking edits preserve flow order and undo in one step", () => {
  const session = new EditorSession(complexFixture());
  const parent = session.doc.pages[0].root;
  const order = parent.children.map((n) => n.id),
    first = parent.children[0];
  session.arrangeMany([first.id], true);
  assert.equal(first.style["z-index"], String(parent.children.length - 1));
  assert.deepEqual(
    parent.children.map((n) => n.id),
    order,
  );
  assert.match(
    String(buildProject(session.doc).files["css/styles.css"]),
    /z-index:/,
  );
  session.undo();
  assert.equal(session.find(first.id)!.style["z-index"], undefined);
});

test("import retains source links and plugin duplicates have no Figma originals", () => {
  const doc = complexFixture();
  for (const node of walk(doc.pages[0].root)) node.sourceId = node.id;
  const session = new EditorSession(doc);
  const child = session.doc.pages[0].root.children[0];
  const copies = session.duplicateMany([child.id]);
  for (const node of walk(session.find(copies[0])!)) assert.equal(node.sourceId, undefined);
  assert.equal(session.find(child.id)?.sourceId, child.id);
  session.undo();
  assert.equal(session.find(child.id)?.sourceId, child.id);
  const ids = session.importInto(doc.pages[0].path, { nodes: [child], assets: [], fonts: [], warnings: [] }, 0, 0);
  assert.equal(session.find(ids[0])?.sourceId, child.id);
});
