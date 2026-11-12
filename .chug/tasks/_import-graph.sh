#!/bin/sh
# The tree's module graph, computed once and asked many times: `build` runs
# dependency-cruiser over the roots with `.dependency-cruiser.cjs`, so a type
# imported alone is an edge as it is for the boundaries, and writes what it
# found to a file the other commands read.
#
# THE FILE IS FOR ANY READER. Under `modules`, each module the graph holds, by
# its path from the root, has `imports` and `importers`, each a list of paths;
# `external`, each package or platform module it imports, as it names it;
# `io`, whether it imports fs, child_process, worker_threads, module or vm,
# the modules through which it can read a file no import names; `opaque`,
# whether its text loads a module by a specifier that is not a literal, or
# takes a platform module from `process.getBuiltinModule`, neither of which
# depcruise sees; and `tracked`, whether git tracks it. `unresolved` lists
# each import that resolved to nothing, or to a module the graph does not
# hold, as `<module> -> <specifier>`. A package is not a module here, since
# its install is what a key holds.
#
# A GRAPH IS BELIEVED ONLY WHERE IT COULD NOT HAVE LOST WHAT IT IS ASKED.
# `reach` refuses, exiting 1, where an entry is not in the graph, where an
# entry whose text imports resolved to no import, and where any import in the
# graph resolved to nothing, a package's included: an install behind the lock
# leaves a package unresolved while every relative import still resolves, so
# the tree read is not the tree installed. `build` exits 1 where depcruise
# fails or its output cannot be read.
#
# WHAT IT CANNOT SEE is a file a module reads by a path it builds, a module
# loaded by a specifier that is not a literal, and a type a file declares into
# every other's scope. The first two are why `io` and `opaque` are recorded.
#
# A SUITE IS CLOSED WHERE THE GRAPH IS THE WHOLE OF WHAT IT LOADS: the graph
# holds it, git tracks every module it reaches, none of them is `io` or
# `opaque` or has an import that resolved to nothing, and the graph holds an
# import of it wherever its own text imports. `suites` answers that for each
# suite, and refuses where a package resolved to nothing, as `reach` does.
#
# Usage: sh .chug/tasks/_import-graph.sh build <graph> <root>...
#        sh .chug/tasks/_import-graph.sh reach <graph> <entry>...
#        sh .chug/tasks/_import-graph.sh holds <graph> [--not | --untracked]
#        sh .chug/tasks/_import-graph.sh suites <graph> <directory>
#   build  write the graph of what the roots reach to <graph>
#   reach  print each module the entries reach, entries included, a path a
#          line; an entry is a module, a directory standing for each module
#          under it, or `<directory>/<pattern>` for each file in that
#          directory whose name `*` matches
#   holds  print each path read from stdin, a path a line, that is a module
#          the graph holds; with --not, each that is not; with --untracked,
#          each that is one git does not track
#   suites for each suite read from stdin, a path a line, write to
#          <directory>/verdicts `closed<TAB><suite>` or
#          `open<TAB><suite><TAB><why>`, and for each closed one, to
#          <directory>/reach/<suite>, each module it reaches, itself included
# Run from the root.
set -eu
export LC_ALL=C

command="${1:-}"
graph="${2:-}"
if [ "$#" -lt 2 ] || [ -z "$graph" ]; then
	echo "_import-graph: usage: _import-graph.sh build|reach|holds|suites <graph> ..." >&2
	exit 2
fi
shift 2

case "$command" in
build)
	if [ -x ./node_modules/.bin/depcruise ]; then
		depcruise=./node_modules/.bin/depcruise
	else
		echo "_import-graph: no local depcruise; install with \`npm ci\`" >&2
		exit 1
	fi
	if [ ! -f .dependency-cruiser.cjs ]; then
		echo "_import-graph: no .dependency-cruiser.cjs to take the options from" >&2
		exit 1
	fi
	work="$(mktemp -d)" || exit 1
	trap 'rm -rf "$work"' EXIT
	if ! "$depcruise" --config .dependency-cruiser.cjs --output-type json "$@" >"$work/cruised" 2>"$work/said"; then
		echo "_import-graph: depcruise did not complete: $(grep . "$work/said" | tail -n 1)" >&2
		exit 1
	fi
	cruised="$work/cruised"
	tracked="$work/tracked"
	if ! git -c core.quotePath=false ls-files >"$tracked"; then
		echo "_import-graph: git cannot list what it tracks" >&2
		exit 1
	fi
	node -e '
const fs = require("node:fs");
const [cruisedPath, trackedPath, graphPath] = process.argv.slice(1);
const reading = new Set(["fs", "child_process", "worker_threads", "module", "vm"]);
const opaque =
  /(?<![.\w$])(?:import|require)\s*\(\s*(?!(?:"[^"\\\n]*"|\x27[^\x27\\\n]*\x27|`[^`$\\]*`)\s*[,)])|\bgetBuiltinModule\b/u;
const opaqueText = (path) => {
  try {
    return opaque.test(fs.readFileSync(path, "utf8"));
  } catch {
    return true;
  }
};
let cruised;
try {
  cruised = JSON.parse(fs.readFileSync(cruisedPath, "utf8"));
} catch (error) {
  console.error(`_import-graph: what depcruise printed cannot be read: ${error.message}`);
  process.exit(1);
}
if (!cruised || !Array.isArray(cruised.modules)) {
  console.error("_import-graph: what depcruise printed holds no modules");
  process.exit(1);
}
const tracked = new Set(fs.readFileSync(trackedPath, "utf8").split("\n"));
const local = (path) =>
  typeof path === "string" && path !== "" && !path.startsWith("../") &&
  !path.startsWith("/") && !/(^|\/)node_modules\//u.test(path);
const modules = {};
const unresolved = [];
for (const cruisedModule of cruised.modules) {
  if (cruisedModule.coreModule || !local(cruisedModule.source)) continue;
  modules[cruisedModule.source] = {
    imports: [],
    importers: [],
    external: [],
    io: false,
    opaque: opaqueText(cruisedModule.source),
    tracked: tracked.has(cruisedModule.source),
  };
}
for (const cruisedModule of cruised.modules) {
  const held = modules[cruisedModule.source];
  if (held === undefined) continue;
  for (const dependency of cruisedModule.dependencies ?? []) {
    if (dependency.couldNotResolve) {
      unresolved.push(`${cruisedModule.source} -> ${dependency.module}`);
    } else if (local(dependency.resolved) && !dependency.coreModule &&
      modules[dependency.resolved] === undefined) {
      unresolved.push(`${cruisedModule.source} -> ${dependency.module}`);
    } else if (modules[dependency.resolved] === undefined) {
      if (!held.external.includes(dependency.module)) held.external.push(dependency.module);
      if (dependency.coreModule && reading.has(String(dependency.resolved).split("/")[0]))
        held.io = true;
    } else if (!held.imports.includes(dependency.resolved)) {
      held.imports.push(dependency.resolved);
      modules[dependency.resolved].importers.push(cruisedModule.source);
    }
  }
}
fs.writeFileSync(graphPath, JSON.stringify({ modules, unresolved }));
' "$cruised" "$tracked" "$graph"
	;;
reach | holds | suites)
	exec node -e '
const fs = require("node:fs");
const [command, graphPath, ...asked] = process.argv.slice(1);
let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
} catch (error) {
  console.error(`_import-graph: ${graphPath} cannot be read: ${error.message}`);
  process.exit(1);
}
const modules = graph.modules;
if (command === "holds") {
  const [mode = ""] = asked;
  const read = fs.readFileSync(0, "utf8").split("\n").filter((path) => path !== "");
  const kept = read.filter((path) => {
    const held = Object.hasOwn(modules, path);
    if (mode === "--not") return !held;
    if (mode === "--untracked") return held && !modules[path].tracked;
    return held;
  });
  for (const path of kept) console.log(path);
  process.exit(0);
}
const refuse = (why) => {
  console.error(`_import-graph: ${why}`);
  process.exit(1);
};
const importing = /\bfrom\s*["\x27]|^\s*import\s*["\x27]|\bimport\s*\(|\brequire\s*\(/mu;
const importsUnseen = (path) => {
  if (modules[path].imports.length + modules[path].external.length > 0) return false;
  try {
    return importing.test(fs.readFileSync(path, "utf8"));
  } catch {
    return true;
  }
};
if (command === "suites") {
  const [directory] = asked;
  const dangling = new Map();
  for (const each of graph.unresolved) {
    const [from, specifier] = each.split(" -> ");
    if (!/^[./]/u.test(specifier)) refuse(`an import resolved to nothing: ${each}`);
    dangling.set(from, each);
  }
  const why = (path) => {
    const held = modules[path];
    if (held.io) return `it reaches ${path}, which imports fs, child_process, worker_threads, module or vm`;
    if (held.opaque) return `it reaches ${path}, which loads a module by a specifier that is not a literal`;
    if (!held.tracked) return `it reaches ${path}, which git does not track`;
    if (dangling.has(path)) return `it reaches ${path}, where an import resolved to nothing: ${dangling.get(path)}`;
    return "";
  };
  const verdicts = [];
  const suites = fs.readFileSync(0, "utf8").split("\n").filter((path) => path !== "");
  for (const suite of suites) {
    if (!Object.hasOwn(modules, suite)) {
      verdicts.push(`open\t${suite}\tthe graph does not hold it`);
      continue;
    }
    if (importsUnseen(suite)) {
      verdicts.push(`open\t${suite}\tit imports, and the graph holds no import of it`);
      continue;
    }
    const reached = new Set([suite]);
    const queue = [suite];
    let opening = "";
    while (queue.length > 0 && opening === "") {
      const path = queue.pop();
      opening = why(path);
      for (const imported of modules[path].imports) {
        if (reached.has(imported)) continue;
        reached.add(imported);
        queue.push(imported);
      }
    }
    if (opening !== "") {
      verdicts.push(`open\t${suite}\t${opening}`);
      continue;
    }
    const kept = `${directory}/reach/${suite}`;
    fs.mkdirSync(kept.slice(0, kept.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(kept, [...reached].sort().map((path) => `${path}\n`).join(""));
    verdicts.push(`closed\t${suite}`);
  }
  fs.writeFileSync(`${directory}/verdicts`, verdicts.map((line) => `${line}\n`).join(""));
  process.exit(0);
}
if (graph.unresolved.length > 0)
  refuse(`an import resolved to nothing: ${graph.unresolved[0]}`);
const entries = [];
for (const entry of asked) {
  const slash = entry.lastIndexOf("/");
  const name = entry.slice(slash + 1);
  if (name.includes("*")) {
    const directory = entry.slice(0, slash);
    const pattern = new RegExp(
      `^${name.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`,
      "u",
    );
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch {
      refuse(`${directory} cannot be listed for ${entry}`);
    }
    const matched = names.filter((each) => pattern.test(each)).map((each) => `${directory}/${each}`);
    if (matched.length === 0) refuse(`${entry} names no file`);
    entries.push(...matched);
  } else if (Object.hasOwn(modules, entry)) {
    entries.push(entry);
  } else {
    const within = Object.keys(modules).filter((path) => path.startsWith(`${entry}/`));
    if (within.length === 0) refuse(`${entry} is not in the graph`);
    entries.push(...within);
  }
}
for (const entry of entries) {
  if (!Object.hasOwn(modules, entry)) refuse(`${entry} is not in the graph`);
  if (modules[entry].imports.length + modules[entry].external.length > 0) continue;
  if (!fs.existsSync(entry)) refuse(`${entry} cannot be read`);
  if (importsUnseen(entry)) refuse(`${entry} imports, and the graph holds no import of it`);
}
const reached = new Set(entries);
const queue = [...entries];
while (queue.length > 0) {
  for (const imported of modules[queue.pop()].imports) {
    if (reached.has(imported)) continue;
    reached.add(imported);
    queue.push(imported);
  }
}
for (const path of [...reached].sort()) console.log(path);
' "$command" "$graph" "$@"
	;;
*)
	echo "_import-graph: no command $command; build, reach, holds or suites" >&2
	exit 2
	;;
esac
