import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const publicPackages = {
  core: {
    dir: join(repoRoot, "packages", "core"),
    packageName: "@depkit/phasekit-core",
  },
  opencode: {
    dir: join(repoRoot, "packages", "opencode"),
    packageName: "@depkit/phasekit-opencode",
  },
  install: {
    dir: join(repoRoot, "packages", "install"),
    packageName: "@depkit/phasekit-install",
  },
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const requestedTargets = args.filter((arg) => arg !== "--dry-run");
const targets = requestedTargets.length === 0 ? ["core", "opencode", "install"] : requestedTargets;

for (const target of targets) {
  if (!(target in publicPackages)) {
    throw new Error(`Unknown publish target: ${target}`);
  }
}

for (const target of targets) {
  const pkg = publicPackages[target];
  const version = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")).version;

  if (!dryRun && packageVersionExists(pkg.packageName, version)) {
    console.log(`Skipping ${pkg.packageName}@${version}; version already exists on npm.`);
    continue;
  }

  const publishArgs = ["publish", "--access", "public"];

  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  console.log(`${dryRun ? "Dry-running" : "Publishing"} ${pkg.packageName}@${version}...`);
  execFileSync("npm", publishArgs, { cwd: pkg.dir, stdio: "inherit" });
}

function packageVersionExists(packageName, version) {
  try {
    execFileSync("npm", ["view", `${packageName}@${version}`, "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
