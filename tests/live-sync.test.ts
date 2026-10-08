import test from "node:test";
import assert from "node:assert/strict";
import { LiveSync } from "../src/plugin/live-sync";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test("live sync debounces bursts and queues while the plugin is busy", async () => {
  let busy = true,
    runs = 0;
  const sync = new LiveSync(
    () => busy,
    async () => {
      runs++;
    },
    10,
  );
  try {
    sync.changed();
    sync.changed();
    sync.changed();
    await wait(35);
    assert.equal(runs, 0);
    busy = false;
    await wait(35);
    assert.equal(runs, 1);
  } finally {
    sync.stop();
  }
});
test("pausing invalidates an in-flight result; resuming refreshes", async () => {
  let release: () => void = () => {},
    valid = true,
    runs = 0;
  const sync = new LiveSync(
    () => false,
    async (current) => {
      runs++;
      if (runs === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        valid = current();
      }
    },
    10,
  );
  try {
    sync.changed();
    await wait(25);
    sync.setEnabled(false);
    release();
    await wait(20);
    assert.equal(valid, false);
    sync.changed();
    await wait(20);
    assert.equal(runs, 1);
    sync.setEnabled(true);
    await wait(25);
    assert.equal(runs, 2);
  } finally {
    sync.stop();
  }
});
