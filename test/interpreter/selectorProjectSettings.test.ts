import assert from "node:assert/strict";
import { test } from "node:test";

import {
  selectorProjectOverridesSchema,
  selectorProjectSettingsSchema,
} from "../../src/contract/requests.ts";
import { resolvedThreadStandingRules } from "../../src/contract/threadSeeding.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { runModelCharsMax, sessionEfforts } from "../../src/contract/http.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import type { ProjectAccess } from "../../src/interpreter/nativeWeb.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  checkedSelectorProjectOverrides,
  selectorEffectiveSettings,
  selectorProjectSettingsAdministration,
  selectorProjectSettingsTextCharsMax,
  type SelectorProjectOverrides,
  type SelectorProjectSettingsRecord,
  type SelectorProjectSettingsStore,
  type SelectorProjectSettingsWriteOutcome,
  type SelectorSettingsMovement,
} from "../../src/interpreter/selectorProjectSettings.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const principal = asPrincipal("6:issuersubject");

const administrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("selector-admin"),
};

function access(kinds: readonly string[]): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) =>
      Promise.resolve(kinds.includes(kind) ? administrator : undefined),
    authorizeTenant: () => Promise.resolve(undefined),
    authorizeSite: projectAccessSiteRefused,
  };
}

function record(
  revision: number,
  overrides: SelectorProjectOverrides,
): SelectorProjectSettingsRecord {
  return {
    partition,
    revision,
    overrides,
    effective: selectorEffectiveSettings(overrides),
  };
}

function store(
  written: SelectorProjectSettingsWriteOutcome,
  movedBy?: SelectorSettingsMovement,
): SelectorProjectSettingsStore & {
  readonly writes: {
    expectedRevision: number;
    overrides: SelectorProjectOverrides;
  }[];
} {
  const writes: {
    expectedRevision: number;
    overrides: SelectorProjectOverrides;
  }[] = [];
  return {
    writes,
    read: () =>
      Promise.resolve({
        settings: record(0, {}),
        ...(movedBy === undefined ? {} : { movedBy }),
      }),
    write: (_partition, expectedRevision, overrides) => {
      writes.push({ expectedRevision, overrides });
      return Promise.resolve(written);
    },
    history: () => Promise.resolve([]),
  };
}

test("a project that overrides nothing resolves to the default standing rules and no North Star", () => {
  assert.deepEqual(selectorEffectiveSettings({}), {
    threadStandingRules: resolvedThreadStandingRules(undefined),
  });
});

test("a project's own North Star and standing rules are what it resolves to, and its model and effort are not resolved", () => {
  assert.deepEqual(
    selectorEffectiveSettings({
      northStar: "Ship the console.",
      threadStandingRules: "- You draft, and nothing else.",
      threadModel: "opus",
      threadEffort: "high",
    }),
    {
      northStar: "Ship the console.",
      threadStandingRules: "- You draft, and nothing else.",
    },
  );
});

/**
 * The door is a strict object, so a caller still naming a field of the
 * selector's — an old core setting `mode`, say — is told no rather than
 * answered 200 for an override nothing would run under.
 */
test("the override door takes the four thread fields and refuses every other", () => {
  const admits = (overrides: unknown) =>
    selectorProjectSettingsSchema.safeParse({ expectedRevision: 0, overrides })
      .success;
  assert.deepEqual(Object.keys(selectorProjectOverridesSchema.shape).sort(), [
    "northStar",
    "threadEffort",
    "threadModel",
    "threadStandingRules",
  ]);
  for (const refused of [
    { mode: "Paused" },
    { dispatchMode: "ApprovalRequired" },
    { basePrompt: "Select one." },
    { modelAllowlist: ["*"] },
    { limits: { tokensPerDecision: 1 } },
    { leadModel: "opus" },
    { leadEffort: "high" },
  ])
    assert.equal(admits(refused), false, JSON.stringify(refused));
});

test("an override no column would hold is refused before the row is offered one", () => {
  assert.throws(
    () => checkedSelectorProjectOverrides({ northStar: "" }),
    RangeError,
  );
  assert.throws(
    () => checkedSelectorProjectOverrides({ threadStandingRules: "" }),
    RangeError,
  );
  assert.throws(
    () =>
      checkedSelectorProjectOverrides({
        threadStandingRules: "x".repeat(65_537),
      }),
    RangeError,
  );
  assert.deepEqual(checkedSelectorProjectOverrides({ northStar: "Ship it." }), {
    northStar: "Ship it.",
  });
});

test("the override door's text bound counts code points, matching the schema in front of it", () => {
  const atBound = "😀".repeat(selectorProjectSettingsTextCharsMax);

  assert.deepEqual(checkedSelectorProjectOverrides({ northStar: atBound }), {
    northStar: atBound,
  });
  assert.throws(
    () => checkedSelectorProjectOverrides({ northStar: atBound + "😀" }),
    RangeError,
  );
});

test("reading and writing a project's settings needs selector administration", async () => {
  const denied = selectorProjectSettingsAdministration(
    access(["Read", "Mutate"]),
    store({ written: "Settings", settings: record(1, {}) }),
  );
  assert.deepEqual(await denied.read(principal, partition), {
    result: "NotFound",
  });
  assert.deepEqual(await denied.write(principal, partition, 0, {}), {
    result: "NotFound",
  });
  assert.deepEqual(await denied.history(principal, partition, undefined, 10), {
    result: "NotFound",
  });
});

test("a write carries the revision it was read at and the audited authority", async () => {
  const durable = store({
    written: "Settings",
    settings: record(1, { northStar: "Ship the console." }),
  });
  const administration = selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    durable,
  );
  const written = await administration.write(principal, partition, 0, {
    northStar: "Ship the console.",
  });
  assert.equal(written.result, "Written");
  assert.deepEqual(durable.writes, [
    { expectedRevision: 0, overrides: { northStar: "Ship the console." } },
  ]);
});

test("a write whose fence moved answers the current settings as a conflict", async () => {
  const administration = selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    store({ written: "FenceMoved" }),
  );
  const written = await administration.write(principal, partition, 4, {});
  assert.equal(written.result, "Conflict");
  assert.equal(
    written.result === "Conflict" ? written.settings.revision : undefined,
    0,
  );
});

/** A caller told only the number cannot tell whose write it is looking at. */
test("a conflict names the administrator whose write is now standing", async () => {
  const movedBy = {
    administrator: {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("someone-else"),
    },
    recordedAt: "2026-09-07T10:00:00.000Z",
  };
  const administration = selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    store({ written: "FenceMoved" }, movedBy),
  );
  const written = await administration.write(principal, partition, 4, {});
  assert.deepEqual(
    written.result === "Conflict" ? written.movedBy : undefined,
    movedBy,
  );
  const unmoved = await selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    store({ written: "FenceMoved" }),
  ).write(principal, partition, 4, {});
  assert.equal(
    unmoved.result === "Conflict" ? unmoved.movedBy : "not a conflict",
    undefined,
  );
});

test("an unbounded history page is refused rather than asked for", async () => {
  const administration = selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    store({ written: "FenceMoved" }),
  );
  await assert.rejects(
    () => administration.history(principal, partition, undefined, 0),
    RangeError,
  );
  await assert.rejects(
    () => administration.history(principal, partition, -1, 10),
    RangeError,
  );
  await assert.rejects(
    () => administration.write(principal, partition, -1, {}),
    RangeError,
  );
});

/**
 * A model is a name Claude Code's `--model` takes, judged by the runtime and
 * by no list here; the door refuses only what could not be one or would read
 * as a flag. An effort is one of the agent SDK's five.
 */
test("the door keeps a model name and one of the five efforts, and refuses what could not be either", () => {
  const admits = (overrides: unknown) =>
    selectorProjectSettingsSchema.safeParse({ expectedRevision: 0, overrides })
      .success;
  const kept = [
    "opus",
    "claude-sonnet-5-5",
    "claude-opus-5-5[1m]",
    "m".repeat(runModelCharsMax),
  ];
  for (const model of kept) {
    assert.equal(admits({ threadModel: model }), true, model);
    assert.deepEqual(checkedSelectorProjectOverrides({ threadModel: model }), {
      threadModel: model,
    });
  }
  for (const model of [
    "claude sonnet",
    " opus",
    "opus\n",
    "op\u0000us",
    "-p",
    "--model",
    "",
    "m".repeat(runModelCharsMax + 1),
  ]) {
    assert.equal(admits({ threadModel: model }), false, model);
    assert.throws(
      () => checkedSelectorProjectOverrides({ threadModel: model }),
      RangeError,
      model,
    );
  }
  for (const effort of sessionEfforts)
    assert.equal(admits({ threadEffort: effort }), true, effort);
  for (const effort of ["none", "minimal", "ultra", "Medium", ""]) {
    assert.equal(admits({ threadEffort: effort }), false, effort);
    assert.throws(
      () =>
        checkedSelectorProjectOverrides({
          threadEffort: effort,
        } as unknown as SelectorProjectOverrides),
      RangeError,
      effort,
    );
  }
});
