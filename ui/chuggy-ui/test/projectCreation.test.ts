/** What a name may be before it is sent, the address a project's name makes,
 * which press repeats the last, and what one creation came to. */

import { expect, test } from "vitest";

import { nativeHttpError } from "../../../src/contract/http.ts";
import { classify } from "../../../src/contract/outcomes.ts";
import {
  projectDisplayNameCharsMax,
  projectNameCharsMax,
  projectNameSchema,
} from "../../../src/contract/requests.ts";
import type { ProjectCreatedResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectAddressOf,
  projectCreationAddress,
  projectCreationAddressAsked,
  projectCreationNameLine,
  projectDisplayNameControlFault,
  projectDisplayNameFault,
  projectDisplayNameRule,
  projectCreationNameFault,
  projectCreationRefusalLabel,
  projectCreationSendable,
  projectCreationStanding,
  projectNameRule,
  projectNameLengthFault,
} from "../app/core/projectCreation.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

const partition = { tenant: "vteng", project: "chuggy", name: "Chuggy" };

function status(result: ApiResult<ProjectCreatedResponse>): string {
  return result.outcome === "Ok"
    ? "Created"
    : copyTextEn(projectCreationRefusalLabel(result));
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

test("a name makes its address: lowercased, each run of anything else one hyphen, none at either end", () => {
  expect(projectAddressOf("Acme Billing")).toBe("acme-billing");
  expect(projectAddressOf("Bob's API v2")).toBe("bob-s-api-v2");
  expect(projectAddressOf("  --Hello,   World!!  ")).toBe("hello-world");
  expect(projectAddressOf("Café 東京 2026")).toBe("caf-2026");
  expect(projectAddressOf("already-an-address")).toBe("already-an-address");
});

test("a name with no letter or digit makes no address", () => {
  for (const name of ["", "   ", "!!!", "— ✨ —", "東京"])
    expect(projectAddressOf(name), name).toBe("");
});

test("a name longer than an address may be is cut to the bound, never ending on a hyphen", () => {
  const word = "a".repeat(projectNameCharsMax - 1);
  expect(projectAddressOf(`${word} b`)).toBe(word);
  expect(projectAddressOf("b".repeat(projectNameCharsMax * 2))).toBe(
    "b".repeat(projectNameCharsMax),
  );
  for (const name of [
    `${word} b`,
    "Acme ".repeat(projectNameCharsMax),
    "x-".repeat(projectNameCharsMax),
  ]) {
    const address = projectAddressOf(name);
    expect(address.length, name).toBeLessThanOrEqual(projectNameCharsMax);
    expect(projectNameSchema.safeParse(address).success, name).toBe(true);
  }
});

test("the address follows the name until it is typed, and then stands whatever the name becomes", () => {
  expect(projectCreationAddress({ name: "Acme Billing" })).toBe("acme-billing");
  expect(projectCreationAddressAsked({ name: "Acme Billing" })).toBe(false);
  const edited = { name: "Acme Billing", address: "billing" };
  expect(projectCreationAddress(edited)).toBe("billing");
  expect(projectCreationAddress({ ...edited, name: "Other" })).toBe("billing");
  expect(projectCreationAddressAsked({ ...edited, name: "Other" })).toBe(true);
  expect(projectCreationAddress({ ...edited, address: "" })).toBe("");
});

test("a name that makes no address asks for one, and an empty name asks for nothing yet", () => {
  expect(projectCreationAddressAsked({ name: "!!!" })).toBe(true);
  expect(projectCreationAddressAsked({ name: "" })).toBe(false);
  expect(projectCreationAddressAsked({ name: "  " })).toBe(false);
});

test("the line under the name is the rule, the address it makes, that it makes none, or its fault", () => {
  expect(projectCreationNameLine({ name: "" })).toEqual({
    line: projectDisplayNameRule,
    fault: false,
  });
  expect(projectCreationNameLine({ name: "Acme Billing" })).toEqual({
    line: {
      id: "project-creation-address-made",
      args: { address: "acme-billing" },
    },
    fault: false,
  });
  expect(projectCreationNameLine({ name: "!!!" })).toEqual({
    line: { id: "project-creation-address-none" },
    fault: false,
  });
  expect(copyTextEn(projectCreationNameLine({ name: "Acme" }).line)).toBe(
    "Address: acme",
  );
  expect(projectCreationNameLine({ name: "Ac\tme" })).toEqual({
    line: projectDisplayNameControlFault,
    fault: true,
  });
});

test("a project's name the wire refuses is refused before it is sent, read trimmed", () => {
  expect(projectDisplayNameFault("")).toBeUndefined();
  expect(projectDisplayNameFault("Bob's API v2")).toBeUndefined();
  const longest = "n".repeat(projectDisplayNameCharsMax);
  expect(projectDisplayNameFault(` ${longest} `)).toBeUndefined();
  expect(projectDisplayNameFault(`${longest}n`)).toBe(projectNameLengthFault);
  for (const name of ["Ac\nme", "Acme\u0000", "Acme\u007f"])
    expect(projectDisplayNameFault(name), name).toBe(
      projectDisplayNameControlFault,
    );
});

test("a form is sent only when every name is one the wire takes", () => {
  expect(projectCreationSendable(partition)).toBe(true);
  expect(projectCreationSendable({ ...partition, name: " " })).toBe(false);
  expect(projectCreationSendable({ ...partition, name: "Chug\ngy" })).toBe(
    false,
  );
  expect(projectCreationSendable({ ...partition, tenant: "" })).toBe(false);
  expect(projectCreationSendable({ ...partition, project: "" })).toBe(false);
  expect(projectCreationSendable({ ...partition, project: "Chuggy" })).toBe(
    false,
  );
});

test("what was sent stands only while the form holds every one of its names", () => {
  const sent = { fields: partition, operation: "op-one", status: "Exists" };
  expect(projectCreationStanding(sent, { ...partition })).toBe(sent);
  expect(
    projectCreationStanding(sent, { ...partition, tenant: "acme" }),
  ).toBeUndefined();
  expect(
    projectCreationStanding(sent, { ...partition, project: "arbbot" }),
  ).toBeUndefined();
  expect(
    projectCreationStanding(sent, { ...partition, name: "Chuggy itself" }),
  ).toBeUndefined();
  expect(projectCreationStanding(undefined, partition)).toBeUndefined();
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
    ).toBe(copyTextEn(projectNameRule));
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
