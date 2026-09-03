import assert from "node:assert/strict";
import { test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  asProjectAccessGrant,
  checkedProjectMembership,
  checkedProjectMembershipTarget,
  projectMembershipWriterLacks,
  type ProjectMembershipRequest,
} from "../../src/interpreter/projectMembership.ts";

const request: ProjectMembershipRequest = {
  issuer: "https://accounts.example.test",
  subject: "subject-one",
  tenant: "tenant-one",
  project: "project-one",
  authorityKind: "OidcUser",
  authoritySubject: "internal-user",
  access: ["Read", "DispatchTicket"],
};

test("a provisioned principal is the one the authenticated boundary derives", () => {
  assert.equal(
    checkedProjectMembership(request).principal,
    oidcPrincipal(request.issuer, request.subject),
  );
  assert.equal(
    checkedProjectMembershipTarget(request).principal,
    oidcPrincipal(request.issuer, request.subject),
  );
});

test("a grant carries exactly the access kinds it names", () => {
  assert.deepEqual([...checkedProjectMembership(request).access].sort(), [
    "DispatchTicket",
    "Read",
  ]);
  assert.deepEqual([...asProjectAccessGrant(["Read", "Read"])], ["Read"]);
  assert.deepEqual(
    [
      ...checkedProjectMembership({
        ...request,
        access: "Read,Mutate,ProposeDispatch".split(","),
      }).access,
    ].sort(),
    ["Mutate", "ProposeDispatch", "Read"],
    "the lead's own grant is these three and nothing that dispatches or manages",
  );
});

test("a grant that would set no access is refused before the row is", () => {
  assert.throws(() => asProjectAccessGrant([]), RangeError);
  assert.throws(
    () => checkedProjectMembership({ ...request, access: [] }),
    RangeError,
  );
  assert.throws(
    () => checkedProjectMembership({ ...request, access: ["Everything"] }),
    RangeError,
  );
});

test("every identity a membership names is refused empty", () => {
  for (const empty of [
    { issuer: "" },
    { subject: "" },
    { tenant: "" },
    { project: "" },
    { authorityKind: "" },
    { authoritySubject: "" },
  ]) {
    assert.throws(
      () => checkedProjectMembership({ ...request, ...empty }),
      RangeError,
      `${Object.keys(empty)[0] ?? "a field"} was accepted empty`,
    );
  }
});

test("holding one privilege the action needs is not holding them all", () => {
  const writerOf = (...privileges: string[]) => ({
    role: "someone",
    privileges: new Set(privileges),
  });
  assert.deepEqual(projectMembershipWriterLacks("Grant", writerOf("DELETE")), [
    "INSERT",
    "UPDATE",
  ]);
  assert.deepEqual(projectMembershipWriterLacks("Grant", writerOf("INSERT")), [
    "UPDATE",
  ]);
  assert.deepEqual(projectMembershipWriterLacks("Revoke", writerOf("INSERT")), [
    "DELETE",
  ]);
});

test("a writer holding what the action needs lacks nothing", () => {
  const owner = {
    role: "owner",
    privileges: new Set(["INSERT", "UPDATE", "DELETE"]),
  };
  assert.deepEqual(projectMembershipWriterLacks("Grant", owner), []);
  assert.deepEqual(projectMembershipWriterLacks("Revoke", owner), []);
  assert.deepEqual(
    projectMembershipWriterLacks("Revoke", {
      role: "deleter",
      privileges: new Set(["DELETE"]),
    }),
    [],
  );
});
