import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import type { ProjectAccess } from "../../src/interpreter/nativeWeb.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  resolvedSelectorSettings,
  selectorSettingsFence,
  selectorSettingsFenceHolds,
  type SelectorProjectOverrides,
  type SelectorRuntimeSettings,
} from "../../src/interpreter/selector.ts";
import {
  checkedSelectorProjectOverrides,
  selectorProjectSettingsAdministration,
  type SelectorProjectSettingsRecord,
  type SelectorProjectSettingsStore,
  type SelectorProjectSettingsWriteOutcome,
} from "../../src/interpreter/selectorProjectSettings.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const principal = asPrincipal("6:issuersubject");

const administrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("selector-admin"),
};

const defaults: SelectorRuntimeSettings = {
  revision: 7,
  mode: "Running",
  dispatchMode: "ApprovalRequired",
  basePrompt: "Select at most one currently dispatchable ticket.",
  modelAllowlist: ["*"],
  toolAllowlist: ["*"],
  limits: {
    tokensPerDecision: 8192,
    millisecondsPerDecision: 120_000,
    toolCallsPerDecision: 20,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
};

function access(kinds: readonly string[]): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) =>
      Promise.resolve(kinds.includes(kind) ? administrator : undefined),
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
    effective: resolvedSelectorSettings(
      partition,
      defaults,
      revision,
      overrides,
    ),
  };
}

function store(
  written: SelectorProjectSettingsWriteOutcome,
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
    read: () => Promise.resolve(record(0, {})),
    write: (_partition, expectedRevision, overrides) => {
      writes.push({ expectedRevision, overrides });
      return Promise.resolve(written);
    },
    history: () => Promise.resolve([]),
  };
}

test("an absent override resolves to the installation default", () => {
  const resolved = resolvedSelectorSettings(partition, defaults, 0, {});
  assert.equal(resolved.basePrompt, defaults.basePrompt);
  assert.equal(resolved.mode, defaults.mode);
  assert.deepEqual(resolved.limits, defaults.limits);
  assert.equal(resolved.northStar, undefined);
  assert.equal(resolved.revision, defaults.revision);
  assert.equal(resolved.projectRevision, 0);
});

test("a project overrides upward and keeps the shared pool's limits", () => {
  const resolved = resolvedSelectorSettings(partition, defaults, 3, {
    northStar: "Ship the console.",
    basePrompt: "Prefer tickets that unblock the largest closure.",
    mode: "Paused",
    limits: { tokensPerDecision: defaults.limits.tokensPerDecision * 4 },
  });
  assert.equal(resolved.northStar, "Ship the console.");
  assert.equal(
    resolved.basePrompt,
    "Prefer tickets that unblock the largest closure.",
  );
  assert.equal(resolved.mode, "Paused");
  assert.equal(resolved.limits.tokensPerDecision, 32_768);
  assert.equal(
    resolved.limits.concurrentDecisions,
    defaults.limits.concurrentDecisions,
  );
  assert.equal(
    resolved.limits.selectionsPerMinute,
    defaults.limits.selectionsPerMinute,
  );
  assert.equal(resolved.dispatchMode, defaults.dispatchMode);
  assert.equal(resolved.projectRevision, 3);
});

test("an installation pause is the one ceiling, and the resolved mode says so", () => {
  const paused = resolvedSelectorSettings(
    partition,
    { ...defaults, mode: "Paused" },
    3,
    { mode: "Running" },
  );
  assert.equal(paused.mode, "Paused");
  assert.equal(paused.installationMode, "Paused");
  const running = resolvedSelectorSettings(partition, defaults, 3, {
    mode: "Paused",
  });
  assert.equal(running.mode, "Paused");
  assert.equal(running.installationMode, "Running");
  assert.equal(
    resolvedSelectorSettings(partition, defaults, 3, {}).installationMode,
    "Running",
  );
});

test("the fence holds only while both revisions still name what was read", () => {
  const started = resolvedSelectorSettings(partition, defaults, 3, {});
  const fence = selectorSettingsFence(started);
  assert.equal(selectorSettingsFenceHolds(fence, started), true);
  assert.equal(
    selectorSettingsFenceHolds(
      fence,
      resolvedSelectorSettings(partition, { ...defaults, revision: 8 }, 3, {}),
    ),
    false,
  );
  assert.equal(
    selectorSettingsFenceHolds(
      fence,
      resolvedSelectorSettings(partition, defaults, 4, {}),
    ),
    false,
  );
});

test("an override no column would hold is refused before the row is offered one", () => {
  assert.throws(
    () => checkedSelectorProjectOverrides({ northStar: "" }),
    RangeError,
  );
  assert.throws(
    () => checkedSelectorProjectOverrides({ basePrompt: "x".repeat(65_537) }),
    RangeError,
  );
  assert.throws(
    () => checkedSelectorProjectOverrides({ modelAllowlist: [""] }),
    RangeError,
  );
  assert.throws(
    () => checkedSelectorProjectOverrides({ limits: { tokensPerDecision: 0 } }),
    RangeError,
  );
  assert.throws(
    () =>
      checkedSelectorProjectOverrides({
        limits: { candidatePagesPerDecision: 2 },
      }),
    RangeError,
  );
  assert.deepEqual(checkedSelectorProjectOverrides({ northStar: "Ship it." }), {
    northStar: "Ship it.",
  });
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
  assert.deepEqual(await denied.history(principal, partition, 0, 10), {
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

test("an unbounded history page is refused rather than asked for", async () => {
  const administration = selectorProjectSettingsAdministration(
    access(["ManageProjectSelector"]),
    store({ written: "FenceMoved" }),
  );
  await assert.rejects(
    () => administration.history(principal, partition, 0, 0),
    RangeError,
  );
  await assert.rejects(
    () => administration.write(principal, partition, -1, {}),
    RangeError,
  );
});
