/** What a name may be before it is sent, which press repeats the last, and
 * what one creation came to. */

import { expect, test } from "vitest";

import { nativeHttpError } from "../../../src/contract/http.ts";
import { classify } from "../../../src/contract/outcomes.ts";
import { projectNameCharsMax } from "../../../src/contract/requests.ts";
import type { ProjectCreatedResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectCreationNameFault,
  projectCreationOutcome,
  projectCreationSendable,
  projectCreationStanding,
  projectNameRule,
  projectNameLengthFault,
} from "../app/core/projectCreation.ts";

const partition = { tenant: "vteng", project: "chuggy" };

function status(result: ApiResult<ProjectCreatedResponse>): string {
  const outcome = projectCreationOutcome(result);
  return outcome.outcome === "Refused" ? outcome.status : "Created";
}

test("a name the wire refuses is refused before it is sent, and an empty one says nothing", () => {
  expect(projectCreationNameFault("")).toBeUndefined();
  expect(projectCreationNameFault("chuggy")).toBeUndefined();
  expect(projectCreationNameFault("a-1")).toBeUndefined();
  for (const name of ["Chuggy", "-a", "a-", "a_b", "a b"])
    expect(projectCreationNameFault(name), name).toBe(projectNameRule);
  expect(projectCreationNameFault("a".repeat(projectNameCharsMax))).toBe(
    undefined,
  );
  expect(projectCreationNameFault("a".repeat(projectNameCharsMax + 1))).toBe(
    projectNameLengthFault,
  );
});

test("a form is sent only when both names are ones the wire takes", () => {
  expect(projectCreationSendable(partition)).toBe(true);
  expect(projectCreationSendable({ ...partition, tenant: "" })).toBe(false);
  expect(projectCreationSendable({ ...partition, project: "" })).toBe(false);
  expect(projectCreationSendable({ ...partition, project: "Chuggy" })).toBe(
    false,
  );
});

test("what was sent stands only while the form holds both of its names", () => {
  const sent = { fields: partition, operation: "op-one", status: "Exists" };
  expect(projectCreationStanding(sent, { ...partition })).toBe(sent);
  expect(
    projectCreationStanding(sent, { ...partition, tenant: "acme" }),
  ).toBeUndefined();
  expect(
    projectCreationStanding(sent, { ...partition, project: "arbbot" }),
  ).toBeUndefined();
  expect(projectCreationStanding(undefined, partition)).toBeUndefined();
});

test("a creation or its replay is the project it names", () => {
  expect(projectCreationOutcome({ outcome: "Ok", value: partition })).toEqual({
    outcome: "Created",
    partition,
  });
});

test("each refusal is one short line of its own", () => {
  const conflict = (code: string): ApiResult<ProjectCreatedResponse> => ({
    outcome: "Conflict",
    code,
    body: undefined,
  });
  expect(status(conflict("TenantTaken"))).toBe("Taken");
  expect(status(conflict("ProjectExists"))).toBe("Exists");
  expect(status(conflict("OperationConflict"))).toBe("Conflict");
  for (const code of ["TenantNameInvalid", "ProjectNameInvalid"])
    expect(
      status({ outcome: "Rejected", code, status: 422, body: undefined }),
    ).toBe(projectNameRule);
  expect(
    status({
      outcome: "Rejected",
      code: "TenantNameReserved",
      status: 422,
      body: undefined,
    }),
  ).toBe("Reserved");
  const refused = classify(
    403,
    () => null,
    nativeHttpError(
      "TenantCreationNotPermitted",
      "The site does not permit this caller to create a tenant.",
    ),
  );
  if (refused.outcome === "Ok" || refused.outcome === "Accepted")
    throw new Error("a refusal was classified as a success");
  expect(status(refused)).toBe("New workspace needs an invite link");
  expect(status({ outcome: "Absent" })).toBe("Unavailable");
  expect(
    status({
      outcome: "Retryable",
      code: "AuthorityUnavailable",
      retryAfterSeconds: 1,
    }),
  ).toBe("Unavailable");
  expect(status({ outcome: "Unauthenticated" })).toBe("Not signed in");
  expect(status({ outcome: "Unreachable", reason: "offline" })).toBe(
    "Unreachable",
  );
});
