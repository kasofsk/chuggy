/** A catalog's referenced files, read at the import's commit and stored inline beside their paths. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  importRepositoryConfigurations,
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
  type RepositoryConfigurationDeclaration,
  type RepositoryConfigurationReferenced,
} from "../../src/interpreter/repositoryConfiguration.ts";
import { repositoryConfigurationReferencesMax } from "../../src/interpreter/repositoryConfigurationReference.ts";
import {
  repositoryDeclarationRoot,
  type RepositoryDeclarationFile,
} from "../../src/interpreter/repositoryDeclaration.ts";

const repository = asRepositoryId("repository-one");
const commit = asGitObjectId("a".repeat(40));
const workPrompt = `${repositoryDeclarationRoot}prompts/work.md`;
const reviewWorkload = `${repositoryDeclarationRoot}workloads/review.json`;
const reviewPrompt = `${repositoryDeclarationRoot}prompts/review.md`;

const worker = {
  mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
  setup: [],
  files: [],
};

/** A catalog whose work prompt is a file and whose reviewer is a workload file naming its own prompt file. */
const catalog = {
  version: 2,
  image: "worker:v2",
  workloads: {
    build: { runner: "Agent", prompt: { path: workPrompt }, worker },
    review: reviewWorkload,
  },
  plans: { standard: [{ name: "review", evaluators: ["review"] }] },
  defaults: { work: "build", evaluation: "standard" },
};

const reviewWorkloadFile = {
  runner: "Agent",
  prompt: { path: reviewPrompt },
  worker,
};

function catalogDeclaration(
  configuration: unknown = catalog,
): RepositoryDeclarationFile {
  return {
    path: `${repositoryConfigurationRoot}catalog.json`,
    kind: "File",
    content: JSON.stringify({ version: 1, name: "catalog", configuration }),
  };
}

function file(
  path: string,
  content: string,
): RepositoryConfigurationReferenced {
  return { path, found: "File", content };
}

const everyFile: readonly RepositoryConfigurationReferenced[] = [
  file(workPrompt, "Build what the ticket asks.\n"),
  file(reviewWorkload, JSON.stringify(reviewWorkloadFile)),
  file(reviewPrompt, "Review the change.\n"),
];

function referencedOf(
  files: readonly RepositoryConfigurationReferenced[],
): ReadonlyMap<string, RepositoryConfigurationReferenced> {
  return new Map(files.map((held) => [held.path, held]));
}

function readyDeclaration(
  files: readonly RepositoryConfigurationReferenced[],
): RepositoryConfigurationDeclaration {
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [catalogDeclaration()],
    referenced: referencedOf(files),
  });
  assert.equal(found.readiness, "Ready", JSON.stringify(found));
  if (found.readiness !== "Ready") throw new Error("unreachable");
  const [declared] = found.declarations;
  assert.ok(declared !== undefined);
  return declared;
}

test("an import stores every referenced workload inline and every prompt's text beside its path", () => {
  const declared = readyDeclaration(everyFile);
  const stored: unknown = JSON.parse(declared.canonical);
  assert.deepEqual(stored, {
    ...catalog,
    workloads: {
      build: {
        runner: "Agent",
        prompt: { path: workPrompt, text: "Build what the ticket asks.\n" },
        worker,
      },
      review: {
        runner: "Agent",
        prompt: { path: reviewPrompt, text: "Review the change.\n" },
        worker,
      },
    },
  });
});

test("a prompt naming a path holds what the file held, whatever text it was written with", () => {
  const written = {
    ...catalog,
    workloads: {
      ...catalog.workloads,
      build: {
        runner: "Agent",
        prompt: { path: workPrompt, text: "Something else." },
        worker,
      },
    },
  };
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [catalogDeclaration(written)],
    referenced: referencedOf(everyFile),
  });
  assert.equal(found.readiness, "Ready");
  if (found.readiness !== "Ready") return;
  assert.match(
    found.declarations[0]?.canonical ?? "",
    /Build what the ticket asks/u,
  );
  assert.doesNotMatch(
    found.declarations[0]?.canonical ?? "",
    /Something else/u,
  );
});

test("a reference the commit does not hold as a regular file refuses its declaration and names it", () => {
  const cases: readonly [RepositoryConfigurationReferenced, string][] = [
    [{ path: reviewPrompt, found: "Absent" }, "ReferenceAbsent"],
    [{ path: reviewPrompt, found: "Symlink" }, "SymlinkRefused"],
    [{ path: reviewPrompt, found: "TooLarge" }, "ContentTooLarge"],
    [
      { path: reviewWorkload, found: "File", content: "{" },
      "DocumentUnreadable",
    ],
  ];
  for (const [replaced, fault] of cases) {
    const files = everyFile.map((held) =>
      held.path === replaced.path ? replaced : held,
    );
    assert.deepEqual(
      repositoryConfigurationImportReadiness({
        repository,
        commit,
        files: [catalogDeclaration()],
        referenced: referencedOf(files),
      }),
      {
        readiness: "Refused",
        faults: [
          {
            path: `${repositoryConfigurationRoot}catalog.json`,
            fault,
            reference: replaced.path,
          },
        ],
      },
      fault,
    );
  }
});

test("a workload file that is not a workload refuses as an invalid configuration", () => {
  const files = everyFile.map((held) =>
    held.path === reviewWorkload
      ? file(reviewWorkload, JSON.stringify({ runner: "Agent" }))
      : held,
  );
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [catalogDeclaration()],
    referenced: referencedOf(files),
  });
  assert.equal(found.readiness, "Refused");
  if (found.readiness !== "Refused") return;
  assert.equal(found.faults[0]?.fault, "ConfigurationInvalid");
});

test("a snapshot naming more files than an import reads is refused whole", () => {
  const workloads = Object.fromEntries(
    Array.from(
      { length: repositoryConfigurationReferencesMax + 1 },
      (_, at) => [
        `w${String(at)}`,
        `${repositoryDeclarationRoot}workloads/w${String(at)}.json`,
      ],
    ),
  );
  const declarations = [0, 1, 2, 3, 4].map((at) => ({
    ...catalogDeclaration({
      ...catalog,
      workloads: Object.fromEntries(
        Object.entries(workloads).filter((_, index) => index % 5 === at),
      ),
    }),
    path: `${repositoryConfigurationRoot}catalog-${String(at)}.json`,
  }));
  assert.deepEqual(
    repositoryConfigurationImportReadiness({
      repository,
      commit,
      files: declarations.map((held, at) => ({
        ...held,
        content: held.content.replace(
          '"name":"catalog"',
          `"name":"catalog-${String(at)}"`,
        ),
      })),
    }),
    {
      readiness: "Refused",
      faults: [
        { path: repositoryConfigurationRoot, fault: "TooManyReferences" },
      ],
    },
  );
});

const binding: RepositoryBinding = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository,
  recoveryEpoch: asRecoveryEpoch("epoch"),
};

test("an import reads a catalog's workload files, then the prompts they name, at the commit it imports", async () => {
  const asked: (readonly string[])[] = [];
  const stored: RepositoryConfigurationDeclaration[] = [];
  const held = referencedOf(everyFile);
  const outcome = await importRepositoryConfigurations({
    partition: binding.partition,
    repository,
    commit,
    authority: {
      kind: asAuthorityKind("Service"),
      subject: asAuthoritySubject("importer"),
    },
    ports: {
      bindings: { binding: () => Promise.resolve(binding) },
      snapshots: {
        snapshot: () =>
          Promise.resolve({ read: "Snapshot", files: [catalogDeclaration()] }),
        referenced: (request, paths) => {
          assert.equal(request.commit, commit);
          asked.push([...paths].sort());
          return Promise.resolve({
            read: "Referenced",
            files: paths.flatMap((path) => held.get(path) ?? []),
          });
        },
      },
      store: {
        importRepositoryConfigurations: (input) => {
          stored.push(...input.declarations);
          return Promise.resolve({ imported: "Imported" });
        },
      },
    },
  });
  assert.deepEqual(outcome, { result: "Imported", declarations: 1 });
  assert.deepEqual(asked, [
    [workPrompt, reviewWorkload].sort(),
    [reviewPrompt],
  ]);
  assert.match(stored[0]?.canonical ?? "", /Review the change/u);
});

test("a reference read that cannot reach the commit is the outcome a snapshot saying so is", async () => {
  const outcome = await importRepositoryConfigurations({
    partition: binding.partition,
    repository,
    commit,
    authority: {
      kind: asAuthorityKind("Service"),
      subject: asAuthoritySubject("importer"),
    },
    ports: {
      bindings: { binding: () => Promise.resolve(binding) },
      snapshots: {
        snapshot: () =>
          Promise.resolve({ read: "Snapshot", files: [catalogDeclaration()] }),
        referenced: () =>
          Promise.resolve({ read: "Unavailable", unavailable: "Repository" }),
      },
      store: {
        importRepositoryConfigurations: () =>
          Promise.reject(new Error("nothing is stored")),
      },
    },
  });
  assert.deepEqual(outcome, {
    result: "Unavailable",
    unavailable: "Repository",
  });
});
