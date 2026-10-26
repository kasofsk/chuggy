#!/bin/sh
# What a Track Record key holds of the packages npm installed, printed for
# ci.sh's `--tool`: each named package and every package it depends on, as
# npm's own record of the install has them, one a line by what it is, and a
# line for each package one asks for saying what it gets. A gate that runs
# one tool keys that tool's packages, and a package the tool does not reach
# moves none of its keys.
#
# A PACKAGE IS WHAT IT IS, NOT WHERE IT IS: its name, its version and the
# integrity npm checked it against, or, wanting one, where it came from. Where
# npm put a copy, and the flags it derives from who asked for one, are not
# what node loads, so a copy hoisted or a flag that flipped moves no key. A
# workspace, which has neither, is where it is declared.
#
# A DEPENDENCY IS FOUND WHERE NODE WOULD FIND IT: in the `node_modules` beside
# the package that asks for it, then in each one above, so a copy npm nested
# under one package is the one that package gets. A workspace's link is
# followed to the workspace. Dependencies, optional ones and peers are all
# followed; one found nowhere is printed as absent rather than left out, so
# its arriving moves the key.
#
# A RECORD THAT CANNOT BE READ, OR THAT HOLDS NO NAMED PACKAGE, FAILS, since a
# tool that fails leaves the gate unrecorded and a closure printed empty would
# read as one that installed nothing.
#
# Usage: sh .chug/tasks/_installed-inputs.sh [--lock <file>] <package>...
#   --lock  the record to read, default node_modules/.package-lock.json; a
#           package-lock.json reads the same way
# Run from the root.
set -eu
export LC_ALL=C

lock=node_modules/.package-lock.json
if [ "${1:-}" = "--lock" ]; then
	lock="${2:?--lock names a file}"
	shift 2
fi
if [ "$#" -eq 0 ]; then
	echo "_installed-inputs: name a package" >&2
	exit 2
fi

exec node -e '
const fs = require("node:fs");
const [lockPath, ...named] = process.argv.slice(1);
let record;
try {
  record = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (error) {
  console.error(`_installed-inputs: ${lockPath} cannot be read: ${error.message}`);
  process.exit(1);
}
const packages = record && record.packages;
if (!packages || typeof packages !== "object") {
  console.error(`_installed-inputs: ${lockPath} holds no packages`);
  process.exit(1);
}
// The directories node searches for a name asked for from one location,
// nearest first: each ancestor that is not itself a node_modules.
function candidates(from, name) {
  const found = [];
  let at = from;
  for (;;) {
    if (!/(^|\/)node_modules$/u.test(at))
      found.push(`${at === "" ? "" : `${at}/`}node_modules/${name}`);
    if (at === "") return found;
    const slash = at.lastIndexOf("/");
    at = slash === -1 ? "" : at.slice(0, slash);
  }
}
// Where the package a name asked for from one location is, a link read as
// the workspace it links to.
function resolve(from, name) {
  const location = candidates(from, name).find((at) => packages[at]);
  if (location === undefined) return undefined;
  const entry = packages[location];
  return entry.link && typeof entry.resolved === "string" && packages[entry.resolved]
    ? entry.resolved
    : location;
}
function identity(location) {
  const entry = packages[location];
  const nested = location.lastIndexOf("node_modules/");
  const name =
    typeof entry.name === "string"
      ? entry.name
      : location.slice(nested === -1 ? 0 : nested + "node_modules/".length);
  if (entry.link) return `${name} link ${entry.resolved}`;
  return `${name}@${entry.version ?? ""} ${entry.integrity ?? entry.resolved ?? location}`;
}
const lines = new Set();
const seen = new Set();
const pending = [];
function reach(location) {
  if (!seen.has(location)) {
    seen.add(location);
    lines.add(identity(location));
    pending.push(location);
  }
  return identity(location);
}
for (const name of named) {
  const location = resolve("", name);
  if (location === undefined) {
    console.error(`_installed-inputs: ${lockPath} holds no ${name}`);
    process.exit(1);
  }
  reach(location);
}
while (pending.length > 0) {
  const from = pending.pop();
  const entry = packages[from];
  const asked = {
    ...entry.peerDependencies,
    ...entry.optionalDependencies,
    ...entry.dependencies,
  };
  for (const name of Object.keys(asked)) {
    const location = resolve(from, name);
    lines.add(`${identity(from)} > ${name} ${location === undefined ? "absent" : reach(location)}`);
  }
}
process.stdout.write([...lines].sort().join("\n") + "\n");
' "$lock" "$@"
