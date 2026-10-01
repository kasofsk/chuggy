/** What a name may be before it is sent, and what one creation came to. */

import { expect, test } from "vitest";

import { projectNameCharsMax } from "../../../src/contract/requests.ts";
import type { ProjectCreatedResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectCreationNameFault,
  projectCreationOutcome,
  projectCreationSendable,
  projectNameCharsFault,
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
    expect(projectCreationNameFault(name), name).toBe(projectNameCharsFault);
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
    ).toBe(projectNameCharsFault);
  expect(
    status({
      outcome: "Rejected",
      code: "TenantNameReserved",
      status: 422,
      body: undefined,
    }),
  ).toBe("Reserved");
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
