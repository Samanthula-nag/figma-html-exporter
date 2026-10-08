import test from "node:test";
import assert from "node:assert/strict";
import { prepareLayout } from "../src/plugin/prepare-layout";
function frame(id: string, children: any[] = []) {
  let mode = "HORIZONTAL";
  const node: any = {
    id,
    name: id,
    type: "FRAME",
    width: 500,
    height: 100,
    relativeTransform: [
      [1, 0, 20],
      [0, 1, 30],
    ],
    children,
    resizeWithoutConstraints(w: number, h: number) {
      this.width = w;
      this.height = h;
    },
    get layoutMode() {
      return mode;
    },
    set layoutMode(value) {
      mode = value;
      this.width = 1;
      children.forEach((child) => {
        child.relativeTransform = [
          [1, 0, 0],
          [0, 1, 0],
        ];
        child.width = 1;
      });
    },
  };
  children.forEach((child) => (child.parent = node));
  return node;
}
function host(selection: any[]) {
  const events: string[] = [];
  (globalThis as any).figma = {
    currentPage: { selection, children: selection, loadAsync: async () => {} },
    commitUndo: () => events.push("commit"),
    triggerUndo: () => events.push("undo"),
    loadFontAsync: async () => {},
  };
  return events;
}
test("prepare freezes nested geometry once and leaves import separate", async () => {
  const inner = frame("inner"),
    root = frame("root", [inner]);
  const events = host([root, inner]);
  const result = await prepareLayout("selection");
  assert.equal(result.changed, 2);
  assert.equal(root.layoutMode, "NONE");
  assert.equal(inner.layoutMode, "NONE");
  assert.equal(root.width, 500);
  assert.equal(inner.width, 500);
  assert.deepEqual(inner.relativeTransform, [
    [1, 0, 20],
    [0, 1, 30],
  ]);
  assert.deepEqual(events, ["commit", "commit"]);
  assert.equal((await prepareLayout("selection")).changed, 0);
});
test("protected instances, locked frames and auto-layout outside scope are skipped", async () => {
  const instance = frame("instance");
  instance.type = "INSTANCE";
  const locked = frame("locked");
  locked.locked = true;
  const child = frame("child");
  frame("outside", [child]);
  host([instance, locked, child]);
  const result = await prepareLayout("selection");
  assert.equal(result.changed, 0);
  assert.equal(result.skipped.length, 3);
});
test("font preflight fails before modifying original Figma geometry", async () => {
  const text = frame("text");
  text.type = "TEXT";
  text.characters = "Hello";
  text.getRangeAllFontNames = () => [{ family: "Missing", style: "Regular" }];
  const root = frame("root", [text]);
  const events = host([root]);
  (globalThis as any).figma.loadFontAsync = async () => {
    throw new Error("missing font");
  };
  await assert.rejects(prepareLayout("page"), /missing font/);
  assert.equal(root.layoutMode, "HORIZONTAL");
  assert.deepEqual(events, []);
});
test("mutation failure invokes undo instead of leaving a partial preparation", async () => {
  const root = frame("root");
  root.resizeWithoutConstraints = () => {
    throw new Error("resize failed");
  };
  const events = host([root]);
  await assert.rejects(prepareLayout("selection"), /changes were undone/);
  assert.deepEqual(events, ["commit", "commit", "undo"]);
});
