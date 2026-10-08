import test from "node:test";
import assert from "node:assert/strict";
import { complexFixture } from "./fixture";
import { EditorSession } from "../src/editor/session";
import { fontVariants } from "../src/fonts/web-fonts";
import { buildProject } from "../src/exporter/project-builder";
test("font warnings clear only after every exported style has a supplied face; undo restores them", () => {
  const doc = complexFixture(),
    family = doc.fonts[0];
  doc.warnings.push(
    "Font " +
      family +
      ": binary is not exposed by the Plugin API; install or supply a licensed web font.",
  );
  const session = new EditorSession(doc),
    variants = fontVariants(doc, family);
  for (const variant of variants)
    session.addWebFont({
      family,
      ...variant,
      dataUrl: "data:font/woff2;base64,d09GMg==",
    });
  assert.ok(
    !session.doc.warnings.some((w) => w.startsWith("Font " + family + ":")),
  );
  const result = buildProject(session.doc);
  assert.deepEqual(result.errors, []);
  assert.match(String(result.files["css/styles.css"]), /@font-face/);
  assert.match(String(result.files["css/styles.css"]), /data:font/);
  session.undo();
  assert.ok(
    session.doc.warnings.some((w) => w.startsWith("Font " + family + ":")),
  );
});
