#!/bin/sh
# What a Track Record key holds of the packages npm installed, printed for
# ci.sh's `--tool`: the entries npm's own record of the install keeps for each
# named package and for every package it depends on, one a line, by where it
# is installed and what the record says of it. A gate that runs one tool
# keys that tool's packages, and a package the tool does not reach moves none
# of its keys.
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
const lines = new Set();
const seen = new Set();
const pending = [];
function visit(location) {
  if (seen.has(location)) return;
  seen.add(location);
  const entry = packages[location];
  lines.add(`${location} ${JSON.stringify(entry)}`);
  if (entry.link && typeof entry.resolved === "string" && packages[entry.resolved])
    pending.push(entry.resolved);
  else pending.push(location);
}
function resolve(from, name) {
  return candidates(from, name).find((location) => packages[location]);
}
for (const name of named) {
  const location = resolve("", name);
  if (!location) {
    console.error(`_installed-inputs: ${lockPath} holds no ${name}`);
    process.exit(1);
  }
  visit(location);
}
while (pending.length > 0) {
  const from = pending.pop();
  const entry = packages[from];
  if (from !== "" && !seen.has(from)) {
    seen.add(from);
    lines.add(`${from} ${JSON.stringify(entry)}`);
  }
  const asked = {
    ...entry.peerDependencies,
    ...entry.optionalDependencies,
    ...entry.dependencies,
  };
  for (const name of Object.keys(asked)) {
    const location = resolve(from, name);
    if (location) visit(location);
    else lines.add(`absent ${from} ${name}`);
  }
}
process.stdout.write([...lines].sort().join("\n") + "\n");
' "$lock" "$@"
