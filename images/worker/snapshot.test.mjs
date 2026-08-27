import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";

import { credentialScrub } from "./runEvidence.mjs";

import {
  configurationCandidates,
  runConfigurationBytesMax,
  runConfigurationDigestBytesMax,
  runConfigurationFilesMax,
  runConfigurationFileBytesMax,
  runConfigurationSnapshot,
  runConfigurationWalkDepthMax,
  walkInstructionFiles,
} from "./snapshot.mjs";

const cwd = "/workspace/repository";
const home = "/home/worker";

function at(...parts) {
  return parts.join("/");
}

function directoryEntry(name, directory) {
  return { name, isDirectory: () => directory };
}

function fakeTree(files, directories = {}) {
  return {
    readdir: async (path) => {
      const listed = directories[path];
      if (listed === undefined) throw new Error(`no directory ${path}`);
      return listed;
    },
    stat: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no file ${path}`);
      return { size: Buffer.byteLength(content), isFile: () => true };
    },
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no file ${path}`);
      return Buffer.from(content);
    },
  };
}

async function snapshotOf(files, options = {}) {
  const services = fakeTree(files, options.directories ?? {});
  const bytes = await runConfigurationSnapshot(
    {
      argv: options.argv ?? ["-p", "briefing"],
      init: options.init ?? { claude_code_version: "2.1.247", cwd },
      task: options.task,
      cwd,
      home,
      scrub: options.scrub ?? ((text) => text),
    },
    services,
  );
  return JSON.parse(bytes.toString("utf8"));
}

test("the walk skips version control and package directories", async () => {
  const directories = {
    [cwd]: [
      directoryEntry("CLAUDE.md", false),
      directoryEntry(".git", true),
      directoryEntry("node_modules", true),
      directoryEntry("src", true),
    ],
    [`${cwd}/src`]: [directoryEntry("AGENTS.md", false)],
    [`${cwd}/.git`]: [directoryEntry("CLAUDE.md", false)],
    [`${cwd}/node_modules`]: [directoryEntry("CLAUDE.md", false)],
  };
  const found = await walkInstructionFiles(cwd, fakeTree({}, directories));

  assert.deepEqual(found, [`${cwd}/CLAUDE.md`, at(cwd, "src", "AGENTS.md")]);
});

test("the walk stops at its depth bound", async () => {
  const directories = {};
  let path = cwd;
  for (let depth = 0; depth <= runConfigurationWalkDepthMax + 1; depth += 1) {
    directories[path] = [
      directoryEntry("CLAUDE.md", false),
      directoryEntry("down", true),
    ];
    path = `${path}/down`;
  }
  const found = await walkInstructionFiles(cwd, fakeTree({}, directories));

  assert.equal(found.length, runConfigurationWalkDepthMax + 1);
  assert.equal(
    found.at(-1).split("/down").length - 1,
    runConfigurationWalkDepthMax,
  );
});

test("the candidate list is a priority order with each path named once", () => {
  const candidates = configurationCandidates({
    init: {
      memory_paths: [at(home, ".claude", "CLAUDE.md")],
      plugins: [{ path: "/plugins/blessed" }],
    },
    cwd,
    home,
    task: {
      worker: { files: [{ path: ".claude/settings.json", content: "{}" }] },
    },
    walked: [`${cwd}/CLAUDE.md`],
  });
  const sources = new Map(candidates.map(({ path, source }) => [path, source]));

  assert.equal(sources.get(at(home, ".claude", "CLAUDE.md")), "MemoryPath");
  assert.equal(sources.get(`${cwd}/CLAUDE.md`), "ProjectInstruction");
  assert.equal(sources.get(`${cwd}/.claude/settings.json`), "Settings");
  assert.equal(sources.get("/plugins/blessed"), "Plugin");
  assert.equal(
    sources.get("/plugins/blessed/.claude-plugin/plugin.json"),
    "Plugin",
  );
  assert.equal(sources.get(".claude/settings.json"), "Provisioned");
  assert.equal(candidates.length, sources.size);
  assert.equal(
    candidates.filter(({ path }) => path === `${cwd}/CLAUDE.md`).length,
    1,
  );
});

test("the snapshot carries the argv, the init event and the files it names", async () => {
  const snapshot = await snapshotOf({
    [`${cwd}/CLAUDE.md`]: "project instructions",
    [at(home, ".claude", "settings.json")]: '{"model":"opus"}',
  });

  assert.deepEqual(snapshot.argv, ["-p", "briefing"]);
  assert.equal(snapshot.claudeVersion, "2.1.247");
  assert.equal(snapshot.init.cwd, cwd);
  assert.deepEqual(
    snapshot.files.map(({ path, content }) => [path, content]),
    [
      [`${cwd}/CLAUDE.md`, "project instructions"],
      [at(home, ".claude", "settings.json"), '{"model":"opus"}'],
    ],
  );
  assert.match(snapshot.files[0].digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(snapshot.dropped, []);
});

test("a credential in an instruction file is redacted before it is uploaded", async () => {
  const secret = "sk-ant-oat01-0123456789abcdefghij";
  const snapshot = await snapshotOf(
    { [`${cwd}/CLAUDE.md`]: `token ${secret} here` },
    {
      scrub: (text) => text.split(secret).join("[redacted credential]"),
    },
  );

  assert.equal(snapshot.files[0].content, "token [redacted credential] here");
});

test("a file past the per-file bound is truncated and keeps its whole digest", async () => {
  const oversized = "z".repeat(runConfigurationFileBytesMax + 1_000);
  const snapshot = await snapshotOf({ [`${cwd}/CLAUDE.md`]: oversized });

  assert.equal(snapshot.files[0].truncated, true);
  assert.equal(snapshot.files[0].bytes, oversized.length);
  assert.equal(snapshot.files[0].content.length, runConfigurationFileBytesMax);
  assert.equal(
    snapshot.files[0].digest,
    createHash("sha256").update(oversized).digest("hex"),
    "the digest is a reference to the file, not to the excerpt kept",
  );
});

test("the argv and the init event are scrubbed before they are uploaded", async () => {
  const secret = "sk-ant-oat01-0123456789abcdefghijklmnop";
  const bytes = await runConfigurationSnapshot(
    {
      argv: ["-p", `briefing quoting ${secret}`],
      init: { claude_code_version: "2.1.247", apiKeySource: secret },
      cwd: undefined,
      home: undefined,
      scrub: credentialScrub([secret]),
    },
    fakeTree({}),
  );
  const snapshot = JSON.parse(bytes.toString("utf8"));

  assert.ok(!bytes.toString("utf8").includes(secret));
  assert.equal(snapshot.argv[1], "briefing quoting [redacted credential]");
  assert.equal(snapshot.init.apiKeySource, "[redacted credential]");
});

test("an argv too large to carry is referenced by a digest of the argv itself", async () => {
  const argv = [
    "-p",
    "a".repeat(runConfigurationBytesMax),
    "b".repeat(runConfigurationBytesMax),
  ];
  const bytes = await runConfigurationSnapshot(
    {
      argv,
      init: { claude_code_version: "2.1.247" },
      cwd: undefined,
      home: undefined,
      scrub: (text) => text,
    },
    fakeTree({}),
  );
  const snapshot = JSON.parse(bytes.toString("utf8"));

  assert.deepEqual(snapshot.argv, []);
  assert.equal(
    snapshot.argvTruncated.chuggy_truncated.digest,
    createHash("sha256").update(JSON.stringify(argv)).digest("hex"),
    "the reference has to survive the element boundaries it stands for",
  );
});

test("a dropped list too long for the cap cannot push the body over it", async () => {
  const packed = {};
  const memory = [];
  for (let index = 0; index < 4; index += 1) {
    const path = `/memory/packed/${String(index)}/CLAUDE.md`;
    packed[path] = "y".repeat(260_000);
    memory.push(path);
  }
  for (let index = 4; index < runConfigurationFilesMax; index += 1)
    memory.push(`/memory/huge/${String(index)}/CLAUDE.md`);
  const services = {
    readdir: async () => {
      throw new Error("no directory");
    },
    stat: async (path) => ({
      size: packed[path]?.length ?? runConfigurationDigestBytesMax + 1,
      isFile: () => true,
    }),
    readFile: async (path) => Buffer.from(packed[path] ?? ""),
  };
  const bytes = await runConfigurationSnapshot(
    {
      argv: [],
      init: { memory_paths: memory },
      cwd: undefined,
      home: undefined,
      scrub: (text) => text,
    },
    services,
  );
  const snapshot = JSON.parse(bytes.toString("utf8"));

  assert.ok(
    bytes.byteLength <= runConfigurationBytesMax,
    `snapshot was ${String(bytes.byteLength)} bytes against a cap of ${String(runConfigurationBytesMax)}`,
  );
  assert.ok(snapshot.files.length > 0);
  assert.ok(snapshot.dropped.length > 0);
  assert.ok(
    snapshot.droppedOmitted > 0,
    "this packing is meant to reach the boundary the count exists for",
  );
  assert.equal(
    snapshot.files.length + snapshot.dropped.length + snapshot.droppedOmitted,
    memory.length,
    "every file that was there is kept, referenced or counted",
  );
});

test("a file too large to digest is named by its size alone", async () => {
  const services = fakeTree({});
  services.stat = async () => ({
    size: runConfigurationDigestBytesMax + 1,
    isFile: () => true,
  });
  const bytes = await runConfigurationSnapshot(
    {
      argv: [],
      init: { memory_paths: ["/huge/CLAUDE.md"] },
      cwd: undefined,
      home: undefined,
      scrub: (text) => text,
    },
    services,
  );
  const snapshot = JSON.parse(bytes.toString("utf8"));

  assert.deepEqual(snapshot.files, []);
  assert.deepEqual(snapshot.dropped, [
    {
      source: "MemoryPath",
      path: "/huge/CLAUDE.md",
      bytes: runConfigurationDigestBytesMax + 1,
    },
  ]);
});

test("a file that does not fit the snapshot is dropped with its digest", async () => {
  const large = "y".repeat(runConfigurationFileBytesMax);
  const files = {};
  const memory = [];
  for (let index = 0; index < 8; index += 1) {
    const path = `/memory/${String(index)}/CLAUDE.md`;
    files[path] = large;
    memory.push(path);
  }
  const snapshot = await snapshotOf(files, {
    init: { memory_paths: memory },
  });

  assert.ok(snapshot.files.length > 0);
  assert.ok(snapshot.dropped.length > 0);
  assert.equal(snapshot.files.length + snapshot.dropped.length, memory.length);
  assert.match(snapshot.dropped[0].digest, /^[0-9a-f]{64}$/u);
  assert.equal(snapshot.dropped[0].content, undefined);
});

test("the snapshot never exceeds the bound one read answers whole", async () => {
  const large = "y".repeat(runConfigurationFileBytesMax);
  const files = {};
  const memory = [];
  for (let index = 0; index < 32; index += 1) {
    const path = `/memory/${String(index)}/CLAUDE.md`;
    files[path] = large;
    memory.push(path);
  }
  const bytes = await runConfigurationSnapshot(
    {
      argv: [],
      init: { memory_paths: memory },
      cwd: undefined,
      home: undefined,
      scrub: (text) => text,
    },
    fakeTree(files),
  );

  assert.ok(bytes.byteLength <= runConfigurationBytesMax);
});

test("no packing of the boundary carries the body over the cap", async () => {
  const memory = [];
  for (let index = 0; index < runConfigurationFilesMax; index += 1)
    memory.push(`/memory/${String(index)}/CLAUDE.md`);
  const services = {
    readdir: async () => {
      throw new Error("no directory");
    },
    stat: async () => ({
      size: runConfigurationDigestBytesMax + 1,
      isFile: () => true,
    }),
    readFile: async () => Buffer.alloc(0),
  };
  const over = [];
  for (let pad = 0; pad < 48; pad += 1) {
    const bytes = await runConfigurationSnapshot(
      {
        argv: ["a".repeat(runConfigurationBytesMax - 9_000 + pad)],
        init: { memory_paths: memory },
        cwd: undefined,
        home: undefined,
        scrub: (text) => text,
      },
      services,
    );
    const snapshot = JSON.parse(bytes.toString("utf8"));
    if (bytes.byteLength > runConfigurationBytesMax)
      over.push(`${String(pad)}:${String(bytes.byteLength)}`);
    assert.equal(
      snapshot.files.length + snapshot.dropped.length + snapshot.droppedOmitted,
      memory.length,
    );
  }

  assert.deepEqual(over, [], "the count the body ends with has to be budgeted");
});

test("a snapshot that loses nothing to its cap says it omitted nothing", async () => {
  const snapshot = await snapshotOf({
    [`${cwd}/CLAUDE.md`]: "project instructions",
  });

  assert.equal(snapshot.droppedOmitted, 0);
  assert.equal(snapshot.files.length, 1);
  assert.deepEqual(snapshot.dropped, []);
});

test("a provisioned file is named and digested but its bytes are not resent", async () => {
  const snapshot = await snapshotOf(
    {},
    {
      init: {},
      task: {
        worker: { files: [{ path: ".claude/settings.json", content: "{}" }] },
      },
    },
  );

  assert.deepEqual(snapshot.files, [
    {
      source: "Provisioned",
      path: ".claude/settings.json",
      bytes: 2,
      digest:
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
  ]);
});
