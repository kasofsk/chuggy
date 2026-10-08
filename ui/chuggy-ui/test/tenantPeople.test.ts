/**
 * A workspace's people, decided with no renderer: every refusal the plane
 * names and every role it rosters has its own word, an invitation's fields are
 * held to the contract's schema, and each answer comes to one line.
 */

import { expect, test } from "vitest";

import {
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessLastTenantAdministratorCode,
  accessProjectRoles,
  accessTenantRoles,
  type AccessTenantPerson,
} from "../../../src/contract/accessPlane.ts";
import {
  accessCodeLabel,
  projectRoleLabel,
  tenantInvitationBody,
  tenantInvitationEmailFault,
  tenantInvitationGithubFault,
  tenantInvitationOutcome,
  tenantInvitationProjectsFault,
  tenantInvitationProjectToggled,
  tenantInvitationSendable,
  tenantPeopleOtherIssuersLine,
  tenantPersonName,
  tenantRoleChangeAsks,
  tenantRoleChangeNote,
  tenantRoleLabel,
} from "../app/core/tenantPeople.ts";
import type { TenantInvitationForm } from "../app/core/tenantPeople.ts";

const fallback = /^Unknown refusal/u;

test("every refusal the plane names has its own line, and an unknown one is printed", () => {
  const named = [
    ...Object.values(accessInvitationCodes),
    accessLastTenantAdministratorCode,
  ];
  const lines = named.map((code) => accessCodeLabel(code));
  for (const line of lines) expect(line).not.toMatch(fallback);
  expect(new Set(lines).size).toBe(named.length);
  expect(accessCodeLabel("SomethingNew")).toBe(
    "Unknown refusal (SomethingNew)",
  );
});

test("every role in both rosters has a word", () => {
  expect(accessTenantRoles.map(tenantRoleLabel)).toStrictEqual([
    "Admin",
    "Member",
  ]);
  expect(accessProjectRoles.map(projectRoleLabel)).toStrictEqual([
    "Admin",
    "Developer",
    "Dispatcher",
  ]);
});

const person: AccessTenantPerson = {
  subject: "s-1",
  mine: false,
  tenantRoles: [],
  hostedRuns: false,
  projects: [],
};

test("an account is named by its email, any other subject by itself", () => {
  expect(
    tenantPersonName({
      ...person,
      account: true,
      email: "ada@example.com",
      githubLogin: "ada",
    }),
  ).toStrictEqual({
    name: "ada@example.com",
    subject: false,
    githubLogin: "ada",
    noAccount: false,
  });
  expect(tenantPersonName({ ...person, account: false })).toMatchObject({
    name: "s-1",
    subject: true,
    noAccount: true,
  });
  expect(tenantPersonName(person)).toMatchObject({
    name: "s-1",
    subject: true,
    noAccount: false,
  });
});

test("only removing the reader's own workspace admin is asked first", () => {
  const mine = { ...person, mine: true };
  const removal = { scope: "Tenant", role: "Admin", held: true } as const;
  expect(tenantRoleChangeAsks(mine, removal)).toBe(true);
  expect(tenantRoleChangeAsks(person, removal)).toBe(false);
  expect(tenantRoleChangeAsks(mine, { ...removal, held: false })).toBe(false);
  expect(
    tenantRoleChangeAsks(mine, {
      scope: "Project",
      project: "atlas",
      role: "Admin",
      held: true,
    }),
  ).toBe(false);
});

test("a change answered says nothing, and a refused one its line", () => {
  expect(tenantRoleChangeNote({ outcome: "Ok", value: undefined })).toBe(
    undefined,
  );
  expect(
    tenantRoleChangeNote({
      outcome: "Conflict",
      code: accessLastTenantAdministratorCode,
      body: {},
    }),
  ).toBe("Only admin · grant another first");
  expect(tenantRoleChangeNote({ outcome: "Absent" })).toBe("Not available");
});

test("principals from another sign-in are counted only where there are any", () => {
  expect(tenantPeopleOtherIssuersLine(0)).toBe(undefined);
  expect(tenantPeopleOtherIssuersLine(3)).toBe("3 more from another sign-in");
});

const form: TenantInvitationForm = {
  github: "ada",
  email: "ada@example.com",
  role: "Member",
  projects: [
    { project: "atlas", roles: [] },
    { project: "beacon", roles: [] },
  ],
};

test("a username and an email the schema refuses each have a fault, and an empty one none", () => {
  expect(tenantInvitationGithubFault("")).toBe(undefined);
  expect(tenantInvitationGithubFault("ada")).toBe(undefined);
  expect(tenantInvitationGithubFault("-ada")).toBe("Not a GitHub username");
  expect(tenantInvitationEmailFault("")).toBe(undefined);
  expect(tenantInvitationEmailFault("ada@example.com")).toBe(undefined);
  expect(tenantInvitationEmailFault("ada")).toBe("Not an email");
  expect(tenantInvitationSendable({ ...form, email: "ada" })).toBe(false);
});

test("an invitation names only the projects a role is chosen on", () => {
  expect(tenantInvitationBody(form)).toStrictEqual({
    github: "ada",
    email: "ada@example.com",
    role: "Member",
  });
  const chosen = tenantInvitationProjectToggled(form, "beacon", "Developer");
  expect(tenantInvitationBody(chosen)).toStrictEqual({
    github: "ada",
    email: "ada@example.com",
    role: "Member",
    projects: [{ project: "beacon", roles: ["Developer"] }],
  });
  expect(
    tenantInvitationProjectToggled(chosen, "beacon", "Developer"),
  ).toStrictEqual(form);
});

test("more projects than one invitation names is a fault, and is not sendable", () => {
  const many: TenantInvitationForm = {
    ...form,
    projects: Array.from(
      { length: accessInvitationProjectsMax + 1 },
      (_, index) => ({ project: `p${String(index)}`, roles: ["Admin"] }),
    ),
  };
  expect(tenantInvitationProjectsFault(form)).toBe(undefined);
  expect(tenantInvitationProjectsFault(many)).toBe(
    `At most ${String(accessInvitationProjectsMax)} projects`,
  );
  expect(tenantInvitationSendable(many)).toBe(false);
});

test("an invitation answered closes, a named refusal stays, and an absent one rereads", () => {
  expect(
    tenantInvitationOutcome({
      outcome: "Ok",
      value: { subject: "s-1", created: false },
    }),
  ).toStrictEqual({ outcome: "Invited" });
  expect(
    tenantInvitationOutcome({
      outcome: "Conflict",
      code: accessInvitationCodes.EmailHeld,
      body: {},
    }),
  ).toStrictEqual({
    outcome: "Refused",
    status: "Email held by another account · use another address",
    reread: false,
  });
  expect(tenantInvitationOutcome({ outcome: "Absent" })).toStrictEqual({
    outcome: "Refused",
    status: "Not available",
    reread: true,
  });
});
