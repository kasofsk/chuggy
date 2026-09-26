/**
 * The worker image against this tree. The image runs the worker core at the
 * commit `images/worker/core.json` pins, and its build holds everything it can
 * read off itself; what it cannot read is the server its pods call, and the
 * variable the work launcher leaves to the image.
 *
 * THE PIN'S RELEASE IS HELD TO THE RANGE THE PLANES ACCEPT, which is what a
 * pod's every request is refused against. Raising a plane's floor past it turns
 * this red until the core moves to a release above it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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

/** The environment the built image carries: the last stage's, over every stage it is built from. */
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
  assert.match(environment.get(workerWorkspaceVariable) ?? "", /^\//u);
});
