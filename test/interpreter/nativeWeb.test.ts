import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asPrincipal,
  asPublicInstant,
  nativeWeb,
  type NativeReadStore,
  type ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type OperationInbox,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const operation = asOperationId("operation");
const principal = asPrincipal("principal");
const authority = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("internal-subject"),
};

function boundary(allowed: boolean): {
  readonly web: ReturnType<typeof nativeWeb>;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const access: ProjectAccess = {
    authorize: (_principal, _partition, kind) => {
      calls.push(`authorize:${kind}`);
      return Promise.resolve(allowed ? authority : undefined);
    },
  };
  const reads: NativeReadStore = {
    operation: () => {
      calls.push("read:operation");
      return Promise.resolve({
        operation,
        acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        state: "Pending" as const,
      });
    },
    project: () => {
      calls.push("read:project");
      return Promise.resolve({
        result: "Found" as const,
        project: { partition, sequence: 0, tickets: [] },
      });
    },
  };
  const inbox: OperationInbox = {
    accept: () => {
      calls.push("accept");
      return Promise.resolve({ accepted: "InvalidCommand" });
    },
    cancel: (request) => {
      calls.push(`cancel:${request.authority.subject}`);
      return Promise.resolve({ cancelled: "Unknown" });
    },
    operation: () => Promise.resolve(undefined),
  };
  return { web: nativeWeb(access, reads, inbox), calls };
}

test("inaccessible and absent operation reads share the not-found shape", async () => {
  const { web, calls } = boundary(false);
  assert.equal(await web.operation(principal, partition, operation), undefined);
  assert.deepEqual(calls, ["authorize:Read"]);
});

test("cancellation reauthorizes before reading or writing", async () => {
  const denied = boundary(false);
  assert.deepEqual(await denied.web.cancel(principal, partition, operation), {
    result: "NotFound",
  });
  assert.deepEqual(denied.calls, ["authorize:Mutate"]);

  const allowed = boundary(true);
  assert.equal(
    (await allowed.web.cancel(principal, partition, operation)).result,
    "Found",
  );
  assert.deepEqual(allowed.calls, [
    "authorize:Mutate",
    "read:operation",
    "cancel:internal-subject",
  ]);
});
