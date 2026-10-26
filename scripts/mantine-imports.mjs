import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mantine's public barrel imports every component before re-exporting it.
// Resolve our shared facade to the exact same pinned modules so esbuild can
// keep secondary-only components out of the initial static dependency graph.
// Application code and type checking continue to use the public package API.
export function mantineImports() {
  return {
    name: "mantine-facade-imports",
    setup(build) {
      const entry = fileURLToPath(import.meta.resolve("@mantine/core"));
      let definitions;
      build.onLoad(
        { filter: /src\/ui\/components(?:-[a-z]+)?\.jsx$/ },
        async ({ path }) => {
          if (!definitions) {
            const source = await readFile(entry, "utf8");
            definitions = new Map();
            for (const match of source.matchAll(
              /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
            )) {
              for (const name of match[1]
                .split(",")
                .map((value) => value.trim())) {
                if (name.includes(" as ")) continue;
                definitions.set(name, resolve(dirname(entry), match[2]));
              }
            }
          }
          const source = await readFile(path, "utf8");
          const contents = source.replace(
            /export\s*\{([^}]+)\}\s*from\s*["']@mantine\/core["'];?/g,
            (_, names) =>
              names
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
                .map((name) => {
                  const target = definitions.get(name);
                  if (!target)
                    throw new Error(
                      `Cannot resolve Mantine public export: ${name}`,
                    );
                  return `export { ${name} } from ${JSON.stringify(target)};`;
                })
                .join("\n"),
          );
          return { contents, loader: "jsx", resolveDir: dirname(path) };
        },
      );
    },
  };
}
