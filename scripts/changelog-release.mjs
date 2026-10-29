// Runs from the `version` lifecycle script during `npm version`: renames the
// Unreleased section of CHANGELOG.md to the new version and refreshes the
// compare links. The change is staged so it lands in the version commit.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

const version = process.argv[2] ?? process.env.npm_package_version;
if (!version) {
  console.error("Usage: node scripts/changelog-release.mjs <version>");
  process.exit(1);
}

const path = "CHANGELOG.md";
const changelog = readFileSync(path, "utf8");

const unreleasedHeading = "## [Unreleased]";
const start = changelog.indexOf(unreleasedHeading);
if (start === -1) {
  console.error(`${path} has no "${unreleasedHeading}" section`);
  process.exit(1);
}
const bodyStart = start + unreleasedHeading.length;
const nextHeading = changelog.indexOf("\n## [", bodyStart);
const linkBlock = changelog.indexOf("\n[Unreleased]:", bodyStart);
const bodyEnd = [nextHeading, linkBlock]
  .filter((i) => i !== -1)
  .reduce((a, b) => Math.min(a, b), changelog.length);
if (changelog.slice(bodyStart, bodyEnd).trim() === "") {
  console.error(`${path} has no entries under "${unreleasedHeading}"`);
  process.exit(1);
}

const linkMatch = changelog.match(
  /^\[Unreleased\]: (\S+?\/compare\/)(\S+?)\.\.\.HEAD$/m
);
if (!linkMatch) {
  console.error(`${path} is missing the [Unreleased] compare link`);
  process.exit(1);
}
const [unreleasedLink, compareBase, previousTag] = linkMatch;

const date = new Date().toISOString().slice(0, 10);
const updated = changelog
  .replace(
    unreleasedHeading,
    `${unreleasedHeading}\n\n## [${version}] - ${date}`
  )
  .replace(
    unreleasedLink,
    `[Unreleased]: ${compareBase}v${version}...HEAD\n[${version}]: ${compareBase}${previousTag}...v${version}`
  );

writeFileSync(path, updated);
execFileSync("git", ["add", path], { stdio: "inherit" });
console.log(`Moved Unreleased entries in ${path} to ${version}`);
