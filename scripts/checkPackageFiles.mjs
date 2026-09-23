import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";

const built = (await readdir("dist", { recursive: true }))
  .filter((path) => path.endsWith(".js"))
  .map((path) => `dist/${path}`);
const packed = execFileSync("yarn", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
})
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line).location)
  .filter((path) => typeof path === "string");
const missing = built.filter((path) => !packed.includes(path));

if (built.length === 0 || missing.length > 0) {
  throw new Error(`Package is missing built JavaScript files: ${missing.join(", ")}`);
}

console.log(`Package includes all ${built.length} built JavaScript files.`);
