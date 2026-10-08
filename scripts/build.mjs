import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await build({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  outfile: "dist/main.js",
  target: "es2020",
});
const ui = await build({
  entryPoints: ["src/ui/main.ts"],
  bundle: true,
  write: false,
  target: "es2020",
  define: { __PLUGIN_ID__: JSON.stringify(manifest.id) },
});
await writeFile(
  "dist/ui.html",
  (await readFile("src/ui/index.html", "utf8")).replace("/* BUNDLE */", () =>
    ui.outputFiles[0].text
      .replace(/<\/script/gi, "<\\/script")
      .replace(
        /<script/gi,
        (match) => `<\\x${match.charCodeAt(1).toString(16)}${match.slice(2)}`,
      ),
  ),
);
