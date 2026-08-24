import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationRegistryData,
  configurationRegistryInitial,
  configurationRegistryNext,
  configurationRegistryReceived,
  configurationRegistryRefresh,
} from "../../ui/app/configurationRegistry.js";

const accessToken = "token";
const partition = { tenant: "acme", project: "atlas" };

function configuration(revision: string) {
  return {
    revision,
    parent: undefined,
    digest: `${revision}-digest`,
    createdAt: "2026-08-24T12:00:00Z",
    readiness: "Incomplete" as const,
    provenance: { source: "Authored" as const },
  };
}

function page(revisions: readonly string[], nextCursor?: string) {
  return {
    configurations: revisions.map(configuration),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

test("the initial read starts at page one and becomes registry data", () => {
  const initial = configurationRegistryInitial(accessToken, partition, 25);
  assert.deepEqual(initial.request, {
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/configurations?limit=25",
    headers: {
      accept: "application/vnd.chuggy.v1+json",
      authorization: "Bearer token",
    },
  });
  assert.deepEqual(
    configurationRegistryReceived(initial.state, {
      outcome: "Ok",
      body: page(["second", "first"], "next"),
    }),
    {
      state: "Data",
      configurations: [configuration("second"), configuration("first")],
      nextCursor: "next",
    },
  );
});

test("the next cursor requests and appends the next parsed page", () => {
  const current = {
    state: "Data" as const,
    configurations: [configuration("second")],
    nextCursor: "next",
  };
  const next = configurationRegistryNext(current, accessToken, partition, 10);
  assert.notEqual(next, undefined);
  if (next === undefined) return;
  assert.equal(
    next.request.url,
    `${"/api/v1/tenants/acme/projects/atlas/configurations"}?cursor=next&limit=10`,
  );
  assert.deepEqual(configurationRegistryData(next.state), {
    configurations: current.configurations,
    nextCursor: "next",
  });
  assert.deepEqual(
    configurationRegistryReceived(next.state, {
      outcome: "Ok",
      body: page(["first"]),
    }),
    {
      state: "Data",
      configurations: [configuration("second"), configuration("first")],
      nextCursor: undefined,
    },
  );
});

test("a registry without a continuation cannot request another page", () => {
  assert.equal(
    configurationRegistryNext(
      {
        state: "Data",
        configurations: [],
        nextCursor: undefined,
      },
      accessToken,
      partition,
    ),
    undefined,
  );
});

test("refresh retains visible data while replacing it from page one", () => {
  const current = {
    state: "Data" as const,
    configurations: [configuration("old")],
    nextCursor: "old-next",
  };
  const refresh = configurationRegistryRefresh(current, accessToken, partition);
  assert.equal(refresh.state.load, "Refresh");
  assert.equal(refresh.request.url.endsWith("?limit=50"), true);
  assert.equal(refresh.request.url.includes("cursor"), false);
  assert.deepEqual(configurationRegistryData(refresh.state), {
    configurations: current.configurations,
    nextCursor: "old-next",
  });
  assert.deepEqual(
    configurationRegistryReceived(refresh.state, {
      outcome: "Ok",
      body: page(["new"]),
    }),
    {
      state: "Data",
      configurations: [configuration("new")],
      nextCursor: undefined,
    },
  );
});

test("failed reads are explicit and retain the last data", () => {
  const current = {
    state: "Data" as const,
    configurations: [configuration("held")],
    nextCursor: undefined,
  };
  const refresh = configurationRegistryRefresh(current, accessToken, partition);
  const failed = configurationRegistryReceived(refresh.state, {
    outcome: "Fault",
    code: "Unreachable",
    status: 0,
  });
  assert.equal(failed.state, "Error");
  assert.deepEqual(configurationRegistryData(failed), {
    configurations: current.configurations,
    nextCursor: undefined,
  });
  if (failed.state !== "Error") return;
  assert.deepEqual(failed.error, {
    kind: "Unavailable",
    reason: "The read failed: Unreachable.",
  });
});

test("deferred and unreadable pages become distinct error states", () => {
  const initial = configurationRegistryInitial(accessToken, partition);
  assert.deepEqual(
    configurationRegistryReceived(initial.state, {
      outcome: "Retryable",
      code: "ProjectionBehind",
      retryAfterSeconds: 3,
    }),
    {
      state: "Error",
      held: undefined,
      error: {
        kind: "Deferred",
        code: "ProjectionBehind",
        retryAfterSeconds: 3,
      },
    },
  );
  assert.deepEqual(
    configurationRegistryReceived(initial.state, {
      outcome: "Ok",
      body: { configurations: "not-a-list" },
    }),
    {
      state: "Error",
      held: undefined,
      error: {
        kind: "Unavailable",
        reason: "The server sent a resource this console cannot read.",
      },
    },
  );
});
