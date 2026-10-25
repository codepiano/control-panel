import { build } from "esbuild";
await build({
  entryPoints: ["src/ui/app.jsx"],
  bundle: true,
  outdir: "dist",
  entryNames: "app",
  minify: true,
  sourcemap: false,
  target: ["chrome120", "safari17"],
  jsx: "automatic",
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
