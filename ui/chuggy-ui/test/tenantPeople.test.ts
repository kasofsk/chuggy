/**
 * A workspace's people, decided with no renderer: every refusal the plane
 * names and every role it rosters has its own word, an invitation's fields are
 * held to the contract's schema, each answer comes to one line, and a change is
 * offered only where the reader's abilities say they may make it.
 */

import { expect, test } from "vitest";

import {
  accessHolderNotAdmittedCode,
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessProjectRoles,
  accessTenantRoles,
  type AccessTenantAbilities,
  type AccessTenantPerson,
} from "../../../src/contract/accessPlane.ts";
import {
  accessCodeLabel,
  projectRoleLabel,
  projectRoleOffered,
  tenantInvitationAccountLine,
  tenantInvitationBody,
  tenantInvitationEmailFault,
  tenantInvitationGithubFault,
  tenantInvitationOffered,
  tenantInvitationOutcome,
  tenantInvitationProjects,
  tenantInvitationProjectsFault,
  tenantInvitationProjectToggled,
  tenantInvitationRoleChosen,
  tenantInvitationRoleOpening,
  tenantInvitationRoles,
  tenantInvitationSendable,
  tenantPeopleOtherIssuersLine,
  tenantPersonName,
  tenantPersonProjectDrawn,
  tenantRoleChangeAsks,
  tenantRoleChangeNote,
  tenantRoleLabel,
  tenantRoleOffered,
} from "../app/core/tenantPeople.ts";
import type { TenantInvitationForm } from "../app/core/tenantPeople.ts";

const fallback = /^Unknown refusal/u;

test("every refusal the plane names has its own line, and an unknown one is printed", () => {
  const named = [
    ...Object.values(accessInvitationCodes),
    accessLastTenantAdministratorCode,
    accessNotPermittedCode,
    accessHolderNotAdmittedCode,
  ];
  const lines = named.map((code) => accessCodeLabel(code));
  for (const line of lines) expect(line).not.toMatch(fallback);
  expect(new Set(lines).size).toBe(named.length);
  expect(accessCodeLabel("SomethingNew")).toBe(
    "Unknown refusal (SomethingNew)",
  );
});

test("a change and an account the reader may not make each have their own line", () => {
  expect(accessCodeLabel(accessNotPermittedCode)).toBe("Change not permitted");
  expect(accessCodeLabel(accessInvitationCodes.AccountNotPermitted)).toBe(
    "Account creation not permitted",
  );
  expect(accessCodeLabel(accessHolderNotAdmittedCode)).toBe(
    "Holder not admitted",
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

const abilities: AccessTenantAbilities = {
  tenant: "acme",
  roles: ["Member"],
  grantHostedRuns: false,
  createAccount: false,
  manageAuthorities: false,
  manageSiteHeldAuthorities: false,
  projects: [
    { project: "atlas", roles: [], manageAuthorities: false },
    {
      project: "beacon",
      roles: ["Dispatcher", "Admin"],
      manageAuthorities: false,
    },
  ],
  truncated: false,
};

test("a role is offered only where the abilities name it, and nothing where none were read", () => {
  expect(tenantRoleOffered(abilities, "Member")).toBe(true);
  expect(tenantRoleOffered(abilities, "Admin")).toBe(false);
  expect(tenantRoleOffered(undefined, "Member")).toBe(false);
  expect(projectRoleOffered(abilities, "beacon", "Admin")).toBe(true);
  expect(projectRoleOffered(abilities, "beacon", "Developer")).toBe(false);
  expect(projectRoleOffered(abilities, "atlas", "Admin")).toBe(false);
  expect(projectRoleOffered(abilities, "cut", "Admin")).toBe(false);
  expect(projectRoleOffered(undefined, "beacon", "Admin")).toBe(false);
});

test("a project is drawn in a row where the person holds a role there or the reader may grant one", () => {
  const holding: AccessTenantPerson = {
    ...person,
    projects: [{ project: "atlas", roles: ["Developer"] }],
  };
  expect(tenantPersonProjectDrawn(abilities, holding, "atlas")).toBe(true);
  expect(tenantPersonProjectDrawn(abilities, person, "atlas")).toBe(false);
  expect(tenantPersonProjectDrawn(abilities, person, "beacon")).toBe(true);
  expect(tenantPersonProjectDrawn(undefined, person, "beacon")).toBe(false);
  expect(tenantPersonProjectDrawn(undefined, holding, "atlas")).toBe(true);
});

test("an invitation offers the roles the reader may grant in the roster's order, opening on Member where it may", () => {
  const every: AccessTenantAbilities = {
    ...abilities,
    roles: ["Member", "Admin"],
  };
  expect(tenantInvitationRoles(every)).toStrictEqual(["Admin", "Member"]);
  expect(tenantInvitationRoleOpening(every)).toBe("Member");
  expect(tenantInvitationRoleOpening({ ...abilities, roles: ["Admin"] })).toBe(
    "Admin",
  );
  expect(tenantInvitationOffered(abilities)).toBe(true);
  expect(tenantInvitationOffered({ ...abilities, roles: [] })).toBe(false);
  expect(tenantInvitationOffered(undefined)).toBe(false);
  expect(tenantInvitationRoleOpening(undefined)).toBe(undefined);
});

test("an invitation offers the list's projects the reader may grant on, in the list's order and the roster's", () => {
  expect(
    tenantInvitationProjects(abilities, ["beacon", "atlas", "cut"]),
  ).toStrictEqual([{ project: "beacon", roles: ["Admin", "Dispatcher"] }]);
  expect(tenantInvitationProjects(undefined, ["beacon"])).toStrictEqual([]);
  expect(
    tenantInvitationRoleChosen(
      tenantInvitationProjectToggled(form, "beacon", "Admin"),
      "beacon",
      "Admin",
    ),
  ).toBe(true);
  expect(tenantInvitationRoleChosen(form, "beacon", "Admin")).toBe(false);
});

test("a reader who may not make an account is told so, and one who may is told nothing", () => {
  expect(tenantInvitationAccountLine(abilities)).toBe("Existing accounts only");
  expect(
    tenantInvitationAccountLine({ ...abilities, createAccount: true }),
  ).toBe(undefined);
  expect(tenantInvitationAccountLine(undefined)).toBe(undefined);
});
