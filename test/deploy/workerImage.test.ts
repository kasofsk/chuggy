/**
 * The worker image against this tree. The image runs the worker core at the
 * commit `images/worker/core.json` pins, and its build holds everything it can
 * read off itself; what it cannot read is the server its pods call, the
 * variable the work launcher leaves to the image, and an artifact outside the
 * runtime fetched for the wrong architecture.
 *
 * THE PIN'S RELEASE IS HELD TO THE RANGE THE PLANES ACCEPT, which is what a
 * pod's every request is refused against. Raising a plane's floor past it turns
 * this red until the core moves to a release above it.
 *
 * THE GLIBC A PROJECT'S IMAGE IS TOLD IT NEEDS IS THE FLOOR THE RUNTIME'S
 * BUILD READS OFF ITS OWN BINARIES, so a runtime that comes to need a newer one
 * turns this red until what a project is told says so.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { configurationImageGlibcVersionMin } from "../../src/contract/configurationDocument.ts";
import { workerContractVersionOf } from "../../src/contract/workerContract.ts";
import { workerWorkspaceVariable } from "../../src/contract/workerEnvironment.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
} from "../../src/interpreter/workerPlane.ts";

const pinPath = new URL("../../images/worker/core.json", import.meta.url);
const dockerfilePath = new URL(
  "../../images/worker/Dockerfile",
  import.meta.url,
);

/** The architectures every target is built for, as BuildKit's `TARGETARCH` names them. */
const dockerArchitectures = ["amd64", "arm64"] as const;

/** One build stage: what it is built from and the environment it sets itself. */
interface DockerStage {
  readonly name: string | undefined;
  readonly base: string;
  readonly environment: Map<string, string>;
}

/** The instructions, continuations joined and comment and blank lines dropped as the builder drops them. */
function dockerInstructions(text: string): string[] {
  const instructions: string[] = [];
  let pending = "";
  for (const line of text.split("\n")) {
    if (/^\s*(#|$)/u.test(line)) continue;
    const continued = line.endsWith("\\");
    pending += `${continued ? line.slice(0, -1) : line} `;
    if (continued) continue;
    instructions.push(pending.trim());
    pending = "";
  }
  return instructions;
}

/** The stages in the order the file declares them. */
function dockerStages(text: string): DockerStage[] {
  const stages: DockerStage[] = [];
  for (const instruction of dockerInstructions(text)) {
    const [keyword = "", ...words] = instruction.split(/\s+/u);
    if (keyword === "FROM") {
      const named = words.findIndex((word) => word.toUpperCase() === "AS");
      stages.push({
        name: named === -1 ? undefined : words[named + 1],
        base: words.filter((word) => !word.startsWith("--"))[0] ?? "",
        environment: new Map(),
      });
    } else if (keyword === "ENV") {
      const stage = stages.at(-1);
      assert.ok(stage !== undefined, "ENV before any FROM");
      for (const pair of words) {
        const [name = "", ...value] = pair.split("=");
        stage.environment.set(name, value.join("="));
      }
    }
  }
  return stages;
}

/** The instructions of the stage a name names, from its FROM to the next. */
function stageInstructions(text: string, name: string): string[] {
  const instructions = dockerInstructions(text);
  const start = instructions.findIndex((instruction) =>
    new RegExp(`^FROM .* AS ${name}$`, "u").test(instruction),
  );
  assert.notEqual(start, -1, `no stage is named ${name}`);
  const end = instructions.findIndex(
    (instruction, index) => index > start && instruction.startsWith("FROM "),
  );
  return instructions.slice(start, end === -1 ? undefined : end);
}

/** The default one build argument declares, quoted as this file quotes each it declares. */
function dockerArgumentDefault(text: string, name: string): string | undefined {
  const declared = dockerInstructions(text)
    .map((instruction) =>
      new RegExp(`^ARG ${name}="([^"]*)"$`, "u").exec(instruction),
    )
    .filter((found) => found !== null);
  assert.ok(declared.length <= 1, `${name} is declared more than once`);
  return declared[0]?.[1];
}

/** The environment the built image carries, over every stage it is built from. */
function imageEnvironment(text: string): Map<string, string> {
  const stages = dockerStages(text);
  const chain: DockerStage[] = [];
  let stage = stages.at(-1);
  while (stage !== undefined) {
    assert.ok(chain.length < stages.length, "the stages are built in a cycle");
    chain.unshift(stage);
    const { base } = stage;
    stage = stages.find((named) => named.name === base);
  }
  return new Map(chain.flatMap((built) => [...built.environment]));
}

test("the release the pin names is one the job and session planes accept", () => {
  const { contractRelease } = JSON.parse(readFileSync(pinPath, "utf8")) as {
    contractRelease?: unknown;
  };
  assert.equal(typeof contractRelease, "string");
  assert.notEqual(workerContractVersionOf(String(contractRelease)), undefined);
  assert.ok(
    contractVersionAccepted(workerContractAccepted, String(contractRelease)),
    `${String(contractRelease)} is refused by the planes the core calls`,
  );
});

/** Catches the image and the work launcher naming the workspace apart, since that launcher writes none. */
test("the image names the workspace a work pod reads", () => {
  const environment = imageEnvironment(readFileSync(dockerfilePath, "utf8"));

  assert.ok(environment.size > 0, "the image sets no environment at all");
  assert.match(
    environment.get(workerWorkspaceVariable) ?? "",
    /^\//u,
    "the image names no workspace",
  );
});

test("the glibc a configuration's image is told it needs is the runtime's own floor on each architecture", () => {
  const text = readFileSync(dockerfilePath, "utf8");
  for (const architecture of dockerArchitectures) {
    const name = `RUNTIME_VERSION_FLOOR_${architecture.toUpperCase()}`;
    const floor = dockerArgumentDefault(text, name);
    assert.ok(floor !== undefined, `the runtime's build states no ${name}`);
    const glibc = floor
      .split(" ")
      .filter((version) => version.startsWith("GLIBC_"));
    assert.deepEqual(glibc, [`GLIBC_${configurationImageGlibcVersionMin}`]);
  }
});

/** Catches a pin made for one architecture alone, and an artifact named for one that `TARGETARCH` does not choose. */
test("whatever is made for one architecture is chosen by TARGETARCH, and for each", () => {
  const suffixes = dockerArchitectures.map((name) => name.toUpperCase());
  const pinned = new Map<string, string[]>();
  let choices = 0;
  for (const instruction of dockerInstructions(
    readFileSync(dockerfilePath, "utf8"),
  )) {
    const argument = /^ARG ([A-Z0-9_]+)_(AMD64|ARM64)=/u.exec(instruction);
    if (argument !== null) {
      const [, stem = "", suffix = ""] = argument;
      pinned.set(stem, [...(pinned.get(stem) ?? []), suffix]);
      continue;
    }
    const unchosen = instruction.replace(
      /\bcase "\$TARGETARCH" in (.*?) esac\b/gu,
      (_choice, arms: string) => {
        choices += 1;
        for (const architecture of dockerArchitectures)
          assert.match(
            arms,
            new RegExp(`(^|\\s)${architecture}\\)`, "u"),
            `a choice on TARGETARCH has no ${architecture} arm: ${arms}`,
          );
        return "";
      },
    );
    assert.doesNotMatch(
      unchosen,
      /x86[_-]64|\bx64\b|amd64|aarch64|arm64/u,
      `this names an architecture outside a choice on TARGETARCH: ${instruction}`,
    );
  }
  assert.ok(pinned.size > 0, "the image pins nothing per architecture");
  assert.ok(choices > 0, "the image chooses nothing by TARGETARCH");
  for (const [stem, found] of pinned)
    assert.deepEqual(
      found.toSorted(),
      suffixes,
      `${stem} is pinned for ${found.join(" and ")}`,
    );
});

/** Catches a runtime built without the pins' lag read, or on a verdict cached while npm moved. */
test("the runtime is built only on the pins' lag behind npm, read again whenever npm's newest moves", () => {
  const text = readFileSync(dockerfilePath, "utf8");
  const lag = stageInstructions(text, "agent-lag");
  const gate = lag.findIndex((instruction) =>
    /^RUN .*\.\/\.chug\/tasks\/check-agent-lag\.sh .*&& touch \/agent-lag-clean$/u.test(
      instruction,
    ),
  );
  assert.notEqual(gate, -1, "the agent-lag stage does not run the gate");
  const keys = [
    "ADD https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest ",
    "ADD https://registry.npmjs.org/@openai/codex/latest ",
    "COPY images/worker/Dockerfile ",
    "COPY .chug/tasks/check-agent-lag.sh ",
  ];
  for (const key of keys) {
    const keyed = lag.findIndex((instruction) => instruction.startsWith(key));
    assert.ok(
      keyed !== -1 && keyed < gate,
      `the gate's run in the agent-lag stage is not keyed on ${key.trim()}`,
    );
  }
  assert.ok(
    stageInstructions(text, "runtime").some((instruction) =>
      instruction.startsWith(
        "RUN --mount=type=bind,from=agent-lag,source=/agent-lag-clean,",
      ),
    ),
    "the runtime binds no agent-lag verdict",
  );
});
