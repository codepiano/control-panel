import { build } from "esbuild";
import { mantineImports } from "./mantine-imports.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

await rm("dist", { recursive: true, force: true });
const result = await build({
  plugins: [mantineImports()],
  entryPoints: {
    app: "src/ui/app.jsx",
    "react-runtime": "src/ui/react-runtime.js",
  },
  bundle: true,
  outdir: "dist",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: "linked",
  sourcesContent: true,
  metafile: true,
  target: ["chrome120", "safari17"],
  jsx: "automatic",
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
const outputs = result.metafile.outputs;
const allAssets = Object.keys(outputs).filter((file) => !file.endsWith(".map"));
const initial = new Set();
function visit(file) {
  if (initial.has(file)) return;
  initial.add(file);
  const output = outputs[file];
  if (output.cssBundle) visit(output.cssBundle);
  for (const item of output.imports)
    if (!item.external && item.kind !== "dynamic-import") visit(item.path);
}
visit("dist/app.js");
const staticFiles = [
  ["/", "src/index.html"],
  ["/client.js", "src/client.js"],
  ["/project-tree.js", "src/project-tree.js"],
  ["/assets/favicon.png", "assets/favicon.png"],
];
const rows = [];
for (const [url, file] of [
  ...staticFiles,
  ...allAssets.map((file) => ["/ui/" + file.slice(5), file]),
]) {
  const content = await readFile(file);
  rows.push({
    url,
    file,
    initial: !file.startsWith("dist/") || initial.has(file),
    bytes: content.length,
    gzip: gzipSync(content, { level: 9 }).length,
  });
}
const sum = (files) => ({
  bytes: files.reduce((n, file) => n + file.bytes, 0),
  gzip: files.reduce((n, file) => n + file.gzip, 0),
});
const manifest = {
  entry: "app.js",
  styles: outputs["dist/app.js"].cssBundle.slice(5),
  files: Object.keys(outputs).map((file) => file.slice(5)),
};
const report = {
  scope:
    "HTML, transitive static JS/CSS imports, legacy scripts and favicon; maps, API data and user icons excluded",
  files: rows,
  initial: sum(rows.filter((file) => file.initial)),
  all: sum(rows),
  warnings: result.warnings,
};
await mkdir("dist", { recursive: true });
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
await writeFile(
  "dist/build-meta.json",
  JSON.stringify(result.metafile, null, 2) + "\n",
);
await writeFile(
  "dist/bundle-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Initial static assets: ${report.initial.bytes} bytes, ${report.initial.gzip} bytes gzip (sum per file)`,
);
