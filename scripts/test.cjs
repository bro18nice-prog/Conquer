const { spawnSync } = require("node:child_process");
const path = require("node:path"),
  fs = require("node:fs");
const root = path.resolve(__dirname, "..");
const build = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    path.join(root, "tsconfig.tests.json"),
  ],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status || 1);
const folder = path.join(root, ".test-build/tests");
const files = fs
  .readdirSync(folder)
  .filter((n) => n.endsWith(".test.js"))
  .map((n) => path.join(folder, n));
const run = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});
process.exit(run.status || 0);
