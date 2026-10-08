import test from "node:test";
import assert from "node:assert/strict";
import { createWindowControls } from "../src/plugin/window-controls";
test("window controls clamp sizes, anchor west/north, and convert movement to canvas coordinates", () => {
  const sizes: number[][] = [],
    positions: number[][] = [];
  const controls = createWindowControls(
    {
      resize: (...v: number[]) => sizes.push(v),
      reposition: (...v: number[]) => positions.push(v),
      getPosition: () => ({ canvasSpace: { x: 100, y: 200 } }),
      postMessage: () => {},
    } as unknown as UIAPI,
    () => 2,
  );
  controls.handle({
    type: "window-gesture-start",
    id: 1,
    width: 900,
    height: 650,
  });
  controls.handle({
    type: "window-gesture-update",
    id: 1,
    width: 1,
    height: 1,
    dx: 999,
    dy: 999,
    west: true,
    north: true,
  });
  assert.deepEqual(sizes[sizes.length - 1], [640, 420]);
  assert.deepEqual(positions[positions.length - 1], [230, 315]);
  controls.handle({
    type: "window-gesture-update",
    id: 1,
    width: 99999,
    height: 99999,
    dx: 0,
    dy: 0,
  });
  assert.deepEqual(sizes[sizes.length - 1], [2560, 1600]);
  controls.handle({
    type: "window-gesture-update",
    id: 1,
    width: 900,
    height: 650,
    dx: 80,
    dy: 40,
    move: true,
  });
  assert.deepEqual(positions[positions.length - 1], [140, 220]);
  assert.equal(sizes.length, 2);
  controls.handle({ type: "window-gesture-end", id: 1 });
  controls.handle({
    type: "window-gesture-update",
    id: 1,
    width: 800,
    height: 600,
    dx: 0,
    dy: 0,
  });
  assert.equal(sizes.length, 2);
});
test("unsupported positioning is not advertised; invalid messages cannot resize", () => {
  let count = 0;
  const controls = createWindowControls(
    { resize: () => count++, postMessage: () => {} } as unknown as UIAPI,
    () => 1,
  );
  assert.deepEqual(controls.capabilities(), { resize: true, move: false });
  controls.handle({
    type: "window-gesture-start",
    id: 2,
    width: 900,
    height: 650,
  });
  controls.handle({
    type: "window-gesture-update",
    id: 2,
    width: NaN,
    height: 650,
    dx: 0,
    dy: 0,
  });
  controls.handle({
    type: "window-gesture-update",
    id: 3,
    width: 800,
    height: 650,
    dx: 0,
    dy: 0,
  });
  assert.equal(count, 0);
});
