import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketCatalog } from "../../src/adapters/catalog/ticketCatalog.ts";
import {
  catalogDocument,
  catalogReference,
} from "../../src/adapters/catalog/document.ts";
import { ContentRef, TicketId } from "../../src/domain/chuggernaut/task.js";
import { execution_profile } from "../../src/interpreter/executionProfile.ts";
import {
  CatalogSchemaError,
  type TicketContentStore,
  type TicketCatalogSource,
} from "../../src/interpreter/ticketCatalog.ts";

function catalogPath(file: string): string {
  return `.chug/${file}`;
}

const files = new Map([
  [
    catalogPath("workloads/work.yaml"),
    "kind: workload\nrunner: codex\nmodel: test\nprompt: agents/work.md\nexecution_profile: large\nresult_contract: result-contracts/work.schema.json",
  ],
  [catalogPath("agents/work.md"), "Implement the ticket."],
  [catalogPath("result-contracts/work.schema.json"), '{"type":"object"}'],
  [
    catalogPath("evaluation-plans/review.yaml"),
    "kind: evaluation-plan\nstages:\n  - name: review\n    evaluators: [evaluators/ci.yaml]\n  - name: verification\n    evaluators: [evaluators/ci.yaml]",
  ],
  [
    catalogPath("evaluators/ci.yaml"),
    "kind: evaluator\nname: ci\nworkload:\n  kind: workload\n  runner: script\n  command: [just, check]\n  result_contract: {type: boolean}",
  ],
  [
    catalogPath("finalizers/pr.yaml"),
    "kind: finalizer\noperation: pull-request\ntarget_ref: refs/heads/main\nbranch_prefix: tickets/",
  ],
]);
const document =
  "version: 2\ntitle: Implement feature\ninstructions: Implement and validate it.\nwork: workloads/work.yaml\nevaluation: evaluation-plans/review.yaml\nfinalization: finalizers/pr.yaml\nrework_limit: 0\ninputs: {threshold: 1.0}";

function setup(overrides: ReadonlyMap<string, string> = new Map()) {
  const blobs = new Map<ContentRef, { mediaType: string; content: string }>();
  const content: TicketContentStore = {
    put: (mediaType, value) => {
      const identity = ContentRef(blobs.size + 1);
      blobs.set(identity, { mediaType, content: value });
      return Promise.resolve(identity);
    },
    read: (reference) => Promise.resolve(blobs.get(reference)),
  };
  const source: TicketCatalogSource = {
    repository: "https://github.com/example/repository",
    reworkLimit: 3,
    cloudProject: undefined,
    executionProfiles: new Map([
      [
        "large",
        execution_profile({
          required_capabilities: ["large"],
        }),
      ],
    ]),
    read: (path) => {
      const value = overrides.get(path) ?? files.get(path);
      if (value === undefined) throw new Error(`missing file: ${path}`);
      return Promise.resolve(value);
    },
  };
  return { catalog: ticketCatalog(source, content), blobs };
}

test("catalog resolves adopted ticket structure and immutable execution configuration", async () => {
  const { catalog, blobs } = setup();
  const release = await catalog.release(TicketId(1), document);
  assert.equal(release.definition.id, 1);
  assert.equal(release.reworkLimit, 0);
  assert.equal(release.reworkLimitDeclared, true);
  assert.deepEqual(
    [...release.stageNames.values()],
    ["review", "verification"],
  );
  assert.deepEqual([...release.evaluatorNames.values()], ["ci"]);
  const work = release.definition.work_configuration;
  assert.deepEqual(work.execution_requirements.required_capabilities, [
    "large",
  ]);
  const workload = blobs.get(work.workload)?.content;
  assert.ok(workload?.includes('"publishes_repository_result":true'));
  assert.ok(workload?.includes("Implement the ticket."));
  assert.equal(blobs.get(work.inputs)?.content, '{"threshold":1.0}');
  for (const stage of release.definition.evaluation_plan.stages) {
    const evaluator = stage.evaluators[0]?.task.workload;
    assert.ok(
      blobs
        .get(evaluator ?? work.workload)
        ?.content.includes('"publishes_repository_result":false'),
    );
    assert.equal(stage.evaluators[0]?.key, 1);
  }
  assert.equal(
    blobs.get(release.definition.finalization_configuration)?.content,
    '{"branch_prefix":"tickets/","kind":"finalizer","operation":"pull-request","target_ref":"refs/heads/main"}',
  );
});

test("evaluator workloads cannot request publication access", async () => {
  const overrides = new Map([
    [
      catalogPath("evaluators/ci.yaml"),
      "kind: evaluator\nname: ci\nworkload:\n  kind: workload\n  runner: script\n  command: [just, check]\n  publishes_repository_result: false\n  result_contract: {type: boolean}",
    ],
  ]);
  await assert.rejects(
    setup(overrides).catalog.release(TicketId(1), document),
    /must not declare/,
  );
});

test("ticket omission freezes the project rework limit", async () => {
  const { catalog } = setup();
  const release = await catalog.release(
    TicketId(1),
    document.replace("\nrework_limit: 0", ""),
  );
  assert.equal(release.reworkLimit, 3);
  assert.equal(release.reworkLimitDeclared, false);
});

test("catalog rejects traversal, malformed YAML, cycles and float ticket fields", () => {
  for (const path of [
    "../workloads/work.yaml",
    "workloads/../../work.yaml",
    "/workloads/work.yaml",
    "workloads\\work.yaml",
  ])
    assert.throws(() => catalogReference(path, "workloads", ".yaml"));
  for (const source of [
    "version: 2.0",
    "rework_limit: 1.0",
    "dependencies: [1.0]",
    "cycle: &cycle {self: *cycle}",
    "array: [",
  ])
    assert.throws(() => catalogDocument(source));
});

test("ticket format rejects old authoring fields and duplicate evaluator names", async () => {
  await assert.rejects(
    setup().catalog.release(TicketId(1), `${document}\nintent: old-format`),
    /intent: is not a field this document has/,
  );
  const overrides = new Map([
    [
      catalogPath("evaluation-plans/review.yaml"),
      "kind: evaluation-plan\nstages:\n  - name: review\n    evaluators: [evaluators/ci.yaml, evaluators/ci.yaml]",
    ],
  ]);
  await assert.rejects(
    setup(overrides).catalog.release(TicketId(1), document),
    /duplicate evaluator/,
  );
});

async function finalization(finalizer: string): Promise<string | undefined> {
  const { catalog, blobs } = setup(
    new Map([[catalogPath("finalizers/pr.yaml"), finalizer]]),
  );
  const release = await catalog.release(TicketId(1), document);
  return blobs.get(release.definition.finalization_configuration)?.content;
}

test("a finalizer document carries only the fields its operation honours", async () => {
  assert.equal(
    await finalization(
      "kind: finalizer\noperation: git-merge\ntarget_ref: refs/heads/main",
    ),
    '{"kind":"finalizer","operation":"git-merge","target_ref":"refs/heads/main"}',
  );
  assert.equal(
    await finalization("kind: finalizer\noperation: no-op"),
    '{"kind":"finalizer","operation":"no-op"}',
  );
  for (const refused of [
    "kind: finalizer\noperation: git-merge\ntarget_ref: refs/heads/main\nmerge: true",
    "kind: finalizer\noperation: git-merge\ntarget_ref: refs/heads/main\nbranch_prefix: tickets/",
    "kind: finalizer\noperation: git-merge\ntarget_ref: refs/heads/main\nrelease_ref: refs/heads/release",
    "kind: finalizer\noperation: no-op\ntarget_ref: refs/heads/main",
    "kind: finalizer\noperation: rebase\ntarget_ref: refs/heads/main",
  ])
    await assert.rejects(finalization(refused), /finalizer/u);
});

test("only a finalization that lands something requires work that publishes", async () => {
  const unpublishing = new Map([
    [
      catalogPath("workloads/work.yaml"),
      "kind: workload\nrunner: codex\nmodel: test\nprompt: agents/work.md\nexecution_profile: large\npublishes_repository_result: false\nresult_contract: result-contracts/work.schema.json",
    ],
  ]);
  await assert.rejects(
    setup(unpublishing).catalog.release(TicketId(1), document),
    /publishes a repository result/u,
  );
  const released = await setup(
    new Map([
      ...unpublishing,
      [catalogPath("finalizers/pr.yaml"), "kind: finalizer\noperation: no-op"],
    ]),
  ).catalog.release(TicketId(1), document);
  assert.equal(released.definition.id, 1);
});

test("a schema failure names every field it faulted, each by pointer", async () => {
  await assert.rejects(
    setup().catalog.release(TicketId(1), "version: 2\ndependencies: []\n"),
    (error: unknown) => {
      assert.ok(error instanceof CatalogSchemaError);
      const paths = error.findings.map((finding) => finding.path).sort();
      assert.deepEqual(paths, ["/evaluation", "/finalization", "/work"]);
      assert.ok(
        error.findings.every((finding) => finding.message === "is required"),
      );
      return true;
    },
  );
});
