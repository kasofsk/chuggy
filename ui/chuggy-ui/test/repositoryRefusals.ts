/** The refusals every repository route draws alike, asserted against whichever
 * route's own reading of an outcome is under test. */

import { expect } from "vitest";

import type { ApiFailure } from "../app/core/apiRequest.ts";

export function repositoryRefusalsDrawn(
  status: (refusal: ApiFailure) => string,
): void {
  expect(
    status({ outcome: "Conflict", code: "RepositoryBound", body: undefined }),
  ).toBe("Bound elsewhere");
  expect(
    status({ outcome: "Conflict", code: "OperationConflict", body: undefined }),
  ).toBe("Conflict");
  expect(
    status({
      outcome: "Retryable",
      code: "ForgeUnavailable",
      retryAfterSeconds: 5,
    }),
  ).toBe("Deferring");
  expect(status({ outcome: "Absent" })).toBe("Not found");
  expect(status({ outcome: "Unauthenticated" })).toBe("Not signed in");
  expect(status({ outcome: "Fault", code: "InternalError", status: 500 })).toBe(
    "Failed",
  );
  expect(status({ outcome: "Unreachable", reason: "offline" })).toBe(
    "Unreachable",
  );
  expect(status({ outcome: "Unreadable", reason: "bad body" })).toBe(
    "Unreadable",
  );
}
