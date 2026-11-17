/** Which field a refused creation is drawn under: the one the refusal is
 * about, or none, beside the submit. */

import { expect, test } from "vitest";

import { nativeHttpError } from "../../../src/contract/http.ts";
import { classify } from "../../../src/contract/outcomes.ts";
import type { ApiFailure } from "../app/core/apiRequest.ts";
import { projectCreationRefusalField } from "../app/core/projectCreationRefusalField.ts";

function conflict(code: string): ApiFailure {
  return { outcome: "Conflict", code, body: undefined };
}

function rejected(code: string): ApiFailure {
  return { outcome: "Rejected", code, status: 422, body: undefined };
}

test("a refusal about a field is drawn under that field", () => {
  expect(projectCreationRefusalField(conflict("TenantTaken"))).toBe("tenant");
  expect(projectCreationRefusalField(conflict("ProjectExists"))).toBe(
    "project",
  );
  expect(projectCreationRefusalField(rejected("TenantNameInvalid"))).toBe(
    "tenant",
  );
  expect(projectCreationRefusalField(rejected("TenantNameReserved"))).toBe(
    "tenant",
  );
  expect(projectCreationRefusalField(rejected("ProjectNameInvalid"))).toBe(
    "project",
  );
  expect(
    projectCreationRefusalField(rejected("ProjectDisplayNameInvalid")),
  ).toBe("name");
  const notPermitted = classify(
    403,
    () => null,
    nativeHttpError(
      "TenantCreationNotPermitted",
      "The site does not permit this caller to create a tenant.",
    ),
  );
  if (notPermitted.outcome === "Ok" || notPermitted.outcome === "Accepted")
    throw new Error("a refusal was classified as a success");
  expect(projectCreationRefusalField(notPermitted)).toBe("tenant");
});

test("a refusal about no field, and a creation never answered, name no field", () => {
  for (const failure of [
    conflict("OperationConflict"),
    rejected("Refused"),
    { outcome: "Absent" },
    { outcome: "Unauthenticated" },
    {
      outcome: "Retryable",
      code: "AuthorityUnavailable",
      retryAfterSeconds: 1,
    },
    { outcome: "Unreachable", reason: "offline" },
  ] as const satisfies readonly ApiFailure[])
    expect(
      projectCreationRefusalField(failure),
      failure.outcome,
    ).toBeUndefined();
  expect(projectCreationRefusalField(undefined)).toBeUndefined();
});
