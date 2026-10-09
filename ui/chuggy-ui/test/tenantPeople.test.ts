/**
 * A workspace's people, decided with no renderer: every refusal the plane
 * names and every role it rosters has its own word, a row says what its person
 * holds and nothing else, an invitation's fields are held to the contract's
 * schema, each answer comes to one line, and a change is offered only where
 * the reader's abilities say they may make it.
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
  tenantInvitationBlank,
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
  tenantPeopleCountLine,
  tenantPeopleOtherIssuersLine,
  tenantPeopleParted,
  tenantHostedRunsOffered,
  tenantPersonBoxChecked,
  tenantPersonChangeAsks,
  tenantPersonChangeNote,
  tenantPersonEditOffered,
  tenantPersonEveryProject,
  tenantPersonHeld,
  tenantPersonName,
  tenantPersonProjectBox,
  tenantPersonProjectDrawn,
  tenantPersonProjectLines,
  tenantPersonQuestion,
  tenantPersonWorkspaceBoxes,
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
    "Viewer",
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

test("removing the reader's own workspace admin is asked first, and no other role change", () => {
  const mine = { ...person, mine: true };
  const removal = { scope: "Tenant", role: "Admin", held: true } as const;
  expect(tenantPersonChangeAsks(mine, removal)).toBe(true);
  expect(tenantPersonChangeAsks(person, removal)).toBe(false);
  expect(tenantPersonChangeAsks(mine, { ...removal, held: false })).toBe(false);
  expect(
    tenantPersonChangeAsks(mine, {
      scope: "Project",
      project: "atlas",
      role: "Admin",
      held: true,
    }),
  ).toBe(false);
});

test("taking hosted runs from a subject that is no account is asked first, and giving them is not", () => {
  const selector = { ...person, account: false } as const;
  const taken = { scope: "HostedRuns", held: true } as const;
  expect(tenantPersonChangeAsks(selector, taken)).toBe(true);
  expect(tenantPersonChangeAsks(selector, { ...taken, held: false })).toBe(
    false,
  );
  expect(
    tenantPersonChangeAsks(
      { ...person, account: true, email: "ada@example.com" },
      taken,
    ),
  ).toBe(false);
  expect(tenantPersonChangeAsks(person, taken)).toBe(false);
  expect(
    tenantPersonChangeAsks(
      { ...person, mine: true, account: false },
      {
        scope: "Tenant",
        role: "Admin",
        held: true,
      },
    ),
  ).toBe(true);
});

test("each change asked first has its own question and line", () => {
  expect(
    tenantPersonQuestion({ scope: "HostedRuns", held: true }),
  ).toStrictEqual({
    question: "Remove hosted runs",
    line: "Runs this identity starts will stop.",
  });
  expect(
    tenantPersonQuestion({ scope: "Tenant", role: "Admin", held: true }),
  ).toStrictEqual({
    question: "Remove your admin role",
    line: "You will no longer manage this workspace.",
  });
});

test("a change answered says nothing, and a refused one its line", () => {
  expect(tenantPersonChangeNote({ outcome: "Ok", value: undefined })).toBe(
    undefined,
  );
  expect(
    tenantPersonChangeNote({
      outcome: "Conflict",
      code: accessLastTenantAdministratorCode,
      body: {},
    }),
  ).toBe("Only admin · grant another first");
  expect(tenantPersonChangeNote({ outcome: "Absent" })).toBe("Not available");
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

test("hosted runs are offered only where the abilities say so, and not where none were read", () => {
  expect(tenantHostedRunsOffered(abilities)).toBe(false);
  expect(tenantHostedRunsOffered({ ...abilities, grantHostedRuns: true })).toBe(
    true,
  );
  expect(tenantHostedRunsOffered(undefined)).toBe(false);
});

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

test("a project is a row of an editor where the person holds a role there or the reader may grant one", () => {
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

test("the subjects that are no account are parted from the people, each in the list's order", () => {
  const listed: AccessTenantPerson[] = [
    { ...person, subject: "s-machine", account: false },
    { ...person, subject: "s-ada", account: true },
    { ...person, subject: "s-older" },
    { ...person, subject: "s-other", account: false },
  ];
  const parted = tenantPeopleParted(listed);
  expect(parted.people.map((held) => held.subject)).toStrictEqual([
    "s-ada",
    "s-older",
  ]);
  expect(parted.identities.map((held) => held.subject)).toStrictEqual([
    "s-machine",
    "s-other",
  ]);
});

test("the people are counted in a word that agrees with how many", () => {
  expect([0, 1, 2].map(tenantPeopleCountLine)).toStrictEqual([
    "0 people",
    "1 person",
    "2 people",
  ]);
});

test("a row draws what its person holds in the workspace, roles in the roster's order and hosted runs last", () => {
  expect(tenantPersonHeld(person)).toStrictEqual([]);
  expect(
    tenantPersonHeld({
      ...person,
      tenantRoles: ["Member", "Admin"],
      hostedRuns: true,
    }),
  ).toStrictEqual(["Admin", "Member", "Hosted runs"]);
  expect(tenantPersonHeld({ ...person, hostedRuns: true })).toStrictEqual([
    "Hosted runs",
  ]);
});

test("a workspace admin, and no one else, reads as holding every project", () => {
  expect(tenantPersonEveryProject({ ...person, tenantRoles: ["Admin"] })).toBe(
    true,
  );
  expect(tenantPersonEveryProject({ ...person, tenantRoles: ["Member"] })).toBe(
    false,
  );
  expect(
    tenantPersonEveryProject({
      ...person,
      projects: [{ project: "atlas", roles: ["Admin"] }],
    }),
  ).toBe(false);
});

test("a row draws a line for each project its person holds a role on, in the list's order and the roster's", () => {
  const holding: AccessTenantPerson = {
    ...person,
    projects: [
      { project: "beacon", roles: ["Viewer", "Dispatcher", "Developer"] },
      { project: "atlas", roles: ["Admin"] },
      { project: "cedar", roles: [] },
    ],
  };
  expect(
    tenantPersonProjectLines(holding, ["atlas", "beacon", "cedar", "delta"]),
  ).toStrictEqual([
    { project: "atlas", roles: "Admin" },
    { project: "beacon", roles: "Developer, Dispatcher, Viewer" },
  ]);
  expect(tenantPersonProjectLines(person, ["atlas"])).toStrictEqual([]);
});

test("an editor is offered where the reader may change anything at all, and not where no abilities were read", () => {
  const none: AccessTenantAbilities = { ...abilities, roles: [], projects: [] };
  expect(tenantPersonEditOffered(none, ["atlas", "beacon"])).toBe(false);
  expect(tenantPersonEditOffered(undefined, ["atlas", "beacon"])).toBe(false);
  expect(tenantPersonEditOffered({ ...none, roles: ["Member"] }, [])).toBe(
    true,
  );
  expect(tenantPersonEditOffered({ ...none, grantHostedRuns: true }, [])).toBe(
    true,
  );
  expect(
    tenantPersonEditOffered({ ...none, projects: abilities.projects }, [
      "beacon",
    ]),
  ).toBe(true);
  expect(
    tenantPersonEditOffered({ ...none, projects: abilities.projects }, [
      "atlas",
    ]),
  ).toBe(false);
});

test("an editor's workspace boxes are each role and hosted runs, one the reader may not change only where held", () => {
  const holding: AccessTenantPerson = {
    ...person,
    tenantRoles: ["Admin"],
    hostedRuns: true,
  };
  expect(tenantPersonWorkspaceBoxes(abilities, holding)).toStrictEqual([
    {
      label: "Admin",
      change: { scope: "Tenant", role: "Admin", held: true },
      offered: false,
    },
    {
      label: "Member",
      change: { scope: "Tenant", role: "Member", held: false },
      offered: true,
    },
    {
      label: "Hosted runs",
      change: { scope: "HostedRuns", held: true },
      offered: false,
    },
  ]);
  expect(
    tenantPersonWorkspaceBoxes(abilities, person).map((box) => box.label),
  ).toStrictEqual(["Member"]);
  expect(tenantPersonWorkspaceBoxes(undefined, person)).toStrictEqual([]);
});

test("an editor's project box is the change a press asks for, absent where neither offered nor held", () => {
  const holding: AccessTenantPerson = {
    ...person,
    projects: [{ project: "atlas", roles: ["Developer"] }],
  };
  expect(
    tenantPersonProjectBox(abilities, holding, "atlas", "Developer"),
  ).toStrictEqual({
    label: "Developer",
    change: {
      scope: "Project",
      project: "atlas",
      role: "Developer",
      held: true,
    },
    offered: false,
  });
  expect(tenantPersonProjectBox(abilities, holding, "atlas", "Admin")).toBe(
    undefined,
  );
  expect(
    tenantPersonProjectBox(abilities, holding, "beacon", "Admin"),
  ).toStrictEqual({
    label: "Admin",
    change: { scope: "Project", project: "beacon", role: "Admin", held: false },
    offered: true,
  });
  expect(
    tenantPersonProjectBox(abilities, holding, "beacon", "Developer"),
  ).toBe(undefined);
});

test("a box is checked as the list holds it, and the one being sent as the change will leave it", () => {
  const [member] = tenantPersonWorkspaceBoxes(abilities, person);
  const beacon = tenantPersonProjectBox(abilities, person, "beacon", "Admin");
  if (member === undefined || beacon === undefined)
    throw new Error("the boxes the abilities offer were not drawn");
  expect(tenantPersonBoxChecked(member, undefined)).toBe(false);
  expect(tenantPersonBoxChecked(member, member.change)).toBe(true);
  expect(tenantPersonBoxChecked(beacon, member.change)).toBe(false);
  expect(tenantPersonBoxChecked(beacon, beacon.change)).toBe(true);
  const reread = { ...member, change: { ...member.change, held: true } };
  expect(tenantPersonBoxChecked(reread, member.change)).toBe(true);
  const elsewhere = [
    { scope: "Project", project: "atlas", role: "Admin", held: false },
    { scope: "Project", project: "beacon", role: "Dispatcher", held: false },
    { scope: "Tenant", role: "Admin", held: false },
    { scope: "HostedRuns", held: false },
  ] as const;
  for (const sending of elsewhere)
    expect(tenantPersonBoxChecked(beacon, sending)).toBe(false);
  const held = { ...member, change: { ...member.change, held: true } };
  expect(tenantPersonBoxChecked(held, held.change)).toBe(false);
});

test("an invitation opens with nothing typed and every offered project unchosen", () => {
  expect(
    tenantInvitationBlank("Admin", [
      { project: "atlas" },
      { project: "beacon" },
    ]),
  ).toStrictEqual({
    github: "",
    email: "",
    role: "Admin",
    projects: [
      { project: "atlas", roles: [] },
      { project: "beacon", roles: [] },
    ],
  });
});
