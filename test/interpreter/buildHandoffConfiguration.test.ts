import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import {
  authoredBuildHandoffConfigurationReadiness,
  pinnedBuildHandoffConfigurationReadiness,
  renderBuildHandoff,
} from "../../src/interpreter/buildHandoffConfiguration.ts";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function document(sourceKind: "AcceptedWork" | "PinnedSource") {
  return {
    finalizationHandoff: {
      version: 2,
      source: {
        kind: sourceKind,
        ...(sourceKind === "AcceptedWork"
          ? {
              git: {
                repository: "ssh://git.internal/vteng/chuggy",
                targetRef: "refs/heads/main",
              },
            }
          : {}),
        ...(sourceKind === "PinnedSource"
          ? { git: { repository: "ssh://git.internal/vteng/chuggy" } }
          : {}),
        build: {
          repositoryId: "vteng.chuggy",
          url: "https://github.com/vteng/chuggy.git",
        },
      },
      destination: {
        repository: "ssh://git.internal/gdoteof/chuggy-fabric",
        targetRef: "refs/heads/main",
      },
      credentials: {
        sourceGit: "chuggy-write",
        destinationGit: "chuggy-fabric-write",
        buildSource: "chuggy-source-read",
        buildOutput: "chuggy-registry-push",
      },
      outputs: [
        {
          name: "api",
          contextDirectory: ".",
          dockerfile: "images/api/Dockerfile",
          targetImageRepository: "registry.chuggy.internal/chuggy/api",
        },
        {
          name: "web",
          contextDirectory: ".",
          dockerfile: "images/web/Dockerfile",
          targetImageRepository: "registry.chuggy.internal/chuggy/web",
        },
      ],
      outputBytesMax: 524288,
    },
  };
}

test("accepted work and pinned source are distinct ready variants", () => {
  const accepted = authoredBuildHandoffConfigurationReadiness(
    document("AcceptedWork"),
  );
  const pinned = authoredBuildHandoffConfigurationReadiness(
    document("PinnedSource"),
  );
  assert.equal(accepted.readiness, "Ready");
  assert.equal(pinned.readiness, "Ready");
  if (accepted.readiness === "Ready") {
    assert.equal(accepted.configuration.source.kind, "AcceptedWork");
  }
  if (pinned.readiness === "Ready") {
    assert.equal(pinned.configuration.source.kind, "PinnedSource");
  }
});

test("full deployment renders bounded API and Web requests from one commit", () => {
  const canonical = canonicalConfigurationOf(document("PinnedSource"));
  const readiness = pinnedBuildHandoffConfigurationReadiness(
    canonical,
    { revision: "deploy-full", digest: digest(canonical) },
    digest,
  );
  if (readiness.readiness === "Incomplete") throw new Error(readiness.fault);
  const rendered = renderBuildHandoff(
    readiness.configuration,
    "a".repeat(40),
    digest,
  );
  assert.equal(rendered.length, 2);
  assert.match(rendered[0]?.content ?? "", /images\/api\/Dockerfile/u);
  assert.match(rendered[1]?.content ?? "", /images\/web\/Dockerfile/u);
  assert.ok(rendered.every((each) => each.path.includes("a".repeat(40))));
});

test("duplicate outputs and missing accepted-work Git authority are refused", () => {
  const duplicate = document("PinnedSource");
  const duplicatedOutput = duplicate.finalizationHandoff.outputs[1];
  if (duplicatedOutput === undefined) throw new Error("missing output fixture");
  duplicate.finalizationHandoff.outputs[1] = {
    ...duplicatedOutput,
    name: "api",
  };
  assert.deepEqual(authoredBuildHandoffConfigurationReadiness(duplicate), {
    readiness: "Incomplete",
    fault: "BuildHandoffOutputDuplicated",
  });
  const missing = document("AcceptedWork");
  delete (missing.finalizationHandoff.source as Record<string, unknown>)["git"];
  assert.deepEqual(authoredBuildHandoffConfigurationReadiness(missing), {
    readiness: "Incomplete",
    fault: "BuildHandoffSourceInvalid",
  });
});
