const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "control-panel-mantine-ui-"),
);
process.env.CONTROL_PANEL_DATA = path.join(temporary, "data");
process.env.CONTROL_PANEL_CONFIG = path.join(temporary, "config.json");
fs.writeFileSync(
  process.env.CONTROL_PANEL_CONFIG,
  JSON.stringify({ roots: [], projects: [], scan: { maxDepth: 0 } }),
);
const { createServer } = require("../../src/server");
createServer({ autoStart: false }).then((server) => {
  server.listen(19431, "127.0.0.1");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        fs.rmSync(temporary, { recursive: true, force: true });
        process.exit(0);
      }),
    );
});
