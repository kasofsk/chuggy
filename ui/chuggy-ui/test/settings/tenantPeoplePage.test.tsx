/**
 * The workspace's people page, mounted: a row a person saying what the list
 * holds of them and nothing else, the subjects that are no account in a table
 * of their own, and a person's editor a box for each role the reader may
 * grant, checked where the list holds it, with every other role as it is
 * held. One grant or removal a press, and one notice for a reader the list is
 * not answered to.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, press } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import {
  abilitiesReads,
  boxesIn,
  boxPressed,
  changesSent,
  drawPeople,
  editorOf,
  heldIn,
  hostedRunsPath,
  listReads,
  namedIn,
  peopleAbilitiesAll,
  peopleAbilitiesNone,
  peopleListed,
  peoplePath,
  peopleTenant,
  personRow,
  projectsIn,
  projectsOffered,
  refused,
} from "./tenantPeopleFixture.tsx";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => Promise.resolve(to),
  useParams: () => ({ tenant: peopleTenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a person is a row: an account by its email and login, the reader marked, and what the list holds of them", async () => {
  await drawPeople();
  const ada = personRow("ada@example.com");
  expect(within(ada).getByText("ada")).toBeTruthy();
  expect(within(ada).getByText("You")).toBeTruthy();
  expect(heldIn(ada)).toStrictEqual(["Admin", "Hosted runs"]);
  expect(within(ada).getByText("All projects")).toBeTruthy();
  expect(projectsIn(ada)).toStrictEqual(["atlas: Admin, Developer"]);
  const bob = personRow("s-bob");
  expect(within(bob).queryByText("You")).toBeNull();
  expect(heldIn(bob)).toStrictEqual(["Member"]);
  expect(within(bob).queryByText("All projects")).toBeNull();
  expect(projectsIn(bob)).toStrictEqual([]);
  expect(heldIn(personRow("s-selector"))).toStrictEqual(["Hosted runs"]);
  expect(screen.queryByText("Granted")).toBeNull();
  expect(screen.queryByText("Not granted")).toBeNull();
  styleless();
});

test("the people are counted over their table, and a subject that is no account stands in a second one", async () => {
  await drawPeople();
  expect(screen.getByRole("heading", { name: "1 person" })).toBeTruthy();
  expect(namedIn("People")).toStrictEqual(["ada@example.com"]);
  expect(
    screen.getByRole("heading", { name: "Other identities" }),
  ).toBeTruthy();
  expect(namedIn("Other identities")).toStrictEqual(["s-bob", "s-selector"]);
  expect(screen.queryByText("No account")).toBeNull();
});

test("an answer with no account field draws its subjects among the people", async () => {
  const bare = peopleListed.people.map((person) => ({
    subject: person.subject,
    mine: person.mine,
    tenantRoles: person.tenantRoles,
    hostedRuns: person.hostedRuns,
    projects: person.projects,
  }));
  await drawPeople({
    listing: () => answer({ ...peopleListed, people: bare }),
  });
  expect(namedIn("People")).toStrictEqual(["s-ada", "s-bob", "s-selector"]);
  expect(screen.getByRole("heading", { name: "3 people" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Other identities" })).toBe(
    null,
  );
  expect(screen.queryByText("No account")).toBeNull();
});

test("a list holding only the reader draws that row, with nothing cut or counted", async () => {
  await drawPeople({
    listing: () =>
      answer({ ...peopleListed, people: peopleListed.people.slice(0, 1) }),
  });
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.queryByRole("table", { name: "Other identities" })).toBeNull();
  expect(screen.queryByText(/another sign-in/u)).toBeNull();
  expect(screen.queryByText("List cut short")).toBeNull();
});

test("a cut list, and one counting principals from another sign-in, each say so", async () => {
  await drawPeople({
    listing: () =>
      answer({ ...peopleListed, otherIssuers: 2, truncated: true }),
  });
  expect(screen.getByText("2 more from another sign-in")).toBeTruthy();
  expect(screen.getByText("List cut short")).toBeTruthy();
});

test("an absent list draws the one notice and no control", async () => {
  await drawPeople({
    listing: () => answer({}, 404),
    abilities: () => answer({}, 404),
  });
  expect(screen.getByText("A workspace admin manages people")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(/^Not available/u)).toBeNull();
});

test("a failed list draws its reason, and one that is not JSON draws as unreachable", async () => {
  await drawPeople({ listing: () => answer({}, 500) });
  expect(
    screen.getByText("Failed to load · the API failed with InternalError"),
  ).toBeTruthy();
  cleanup();
  await drawPeople({
    listing: () => new Response("<!doctype html>", { status: 200 }),
  });
  expect(
    screen.getByText(/^Failed to load · the API could not be reached/u),
  ).toBeTruthy();
});

test("a person's editor is a dialog named for them, closed by Done", async () => {
  const drawn = await drawPeople();
  const editor = await editorOf("ada@example.com");
  expect(boxesIn(editor, "Workspace")).toStrictEqual([
    "Admin+",
    "Member",
    "Hosted runs+",
  ]);
  expect(within(editor).queryByRole("button", { name: "Close" })).toBeNull();
  await press("Done");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(changesSent(drawn)).toStrictEqual([]);
  styleless();
});

test("granting a role sends that grant alone and reads the list and the abilities again, each once", async () => {
  const drawn = await drawPeople();
  const read = listReads(drawn);
  const abilitiesRead = abilitiesReads(drawn);
  await boxPressed(await editorOf("s-bob"), "Admin");
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `/access/v1/tenants/${peopleTenant}/people/s-bob/roles`,
      body: { role: "Admin" },
    },
  ]);
  expect(listReads(drawn)).toBe(read + 1);
  expect(abilitiesReads(drawn)).toBe(abilitiesRead + 1);
});

test("removing a project role sends that removal alone, and a project admin asks nothing", async () => {
  const drawn = await drawPeople();
  const read = listReads(drawn);
  await boxPressed(await editorOf("ada@example.com"), "atlas Admin");
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `/access/v1/tenants/${peopleTenant}/projects/atlas/people/s-ada/roles/Admin`,
      body: undefined,
    },
  ]);
  expect(listReads(drawn)).toBeGreaterThan(read);
});

test("granting a project role sends that grant alone", async () => {
  const drawn = await drawPeople();
  await boxPressed(await editorOf("s-bob"), "beacon Dispatcher");
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `/access/v1/tenants/${peopleTenant}/projects/beacon/people/s-bob/roles`,
      body: { role: "Dispatcher" },
    },
  ]);
});

test("a refused change draws its line in the editor, and the box shows what the list holds", async () => {
  await drawPeople({ changed: () => refused(422, "SomethingNew") });
  const editor = await editorOf("s-bob");
  await boxPressed(editor, "Admin");
  expect(
    within(editor).getByText("Unknown refusal (SomethingNew)"),
  ).toBeTruthy();
  expect(boxesIn(editor, "Workspace")).toStrictEqual([
    "Admin",
    "Member+",
    "Hosted runs",
  ]);
  expect(heldIn(personRow("s-bob"))).toStrictEqual(["Member"]);
});

test("removing the only admin draws the conflict's sentence", async () => {
  await drawPeople({ changed: () => refused(409, "LastTenantAdministrator") });
  const editor = await editorOf("s-bob");
  await boxPressed(editor, "Member");
  expect(
    within(editor).getByText("Only admin · grant another first"),
  ).toBeTruthy();
});

test("removing the reader's own admin asks first, and declined sends nothing", async () => {
  const drawn = await drawPeople();
  const editor = await editorOf("ada@example.com");
  await boxPressed(editor, "Admin");
  expect(
    within(editor).getByRole("group", { name: "Remove your admin role" }),
  ).toBeTruthy();
  expect(changesSent(drawn)).toStrictEqual([]);
  await press("Cancel");
  expect(changesSent(drawn)).toStrictEqual([]);
  expect(screen.queryByRole("group", { name: "Remove your admin role" })).toBe(
    null,
  );
  expect(boxesIn(editor, "Workspace")).toContain("Admin+");
});

test("removing the reader's own admin, once confirmed, sends it and draws the notice", async () => {
  let removed = false;
  const drawn = await drawPeople({
    listing: () => (removed ? answer({}, 404) : answer(peopleListed)),
    abilities: () => (removed ? answer({}, 404) : answer(peopleAbilitiesAll())),
    changed: () => {
      removed = true;
      return new Response(null, { status: 204 });
    },
  });
  await boxPressed(await editorOf("ada@example.com"), "Admin");
  await press("Remove");
  expect(changesSent(drawn).map((request) => request.url)).toStrictEqual([
    `${peoplePath}/s-ada/roles/Admin`,
  ]);
  expect(screen.getByText("A workspace admin manages people")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a reader who may grant every role is offered every role on every person and project", async () => {
  await drawPeople();
  for (const name of ["ada@example.com", "s-bob"]) {
    const editor = await editorOf(name);
    expect(
      boxesIn(editor, "Workspace").map((box) => box.replace("+", "")),
    ).toStrictEqual(["Admin", "Member", "Hosted runs"]);
    expect(projectsOffered(editor)).toStrictEqual(peopleListed.projects);
    for (const project of peopleListed.projects)
      expect(
        boxesIn(editor, project).map((box) => box.replace("+", "")),
      ).toStrictEqual([
        `${project} Admin`,
        `${project} Developer`,
        `${project} Dispatcher`,
      ]);
    await press("Done");
  }
});

test("the grid of projects heads its columns once, a role each", async () => {
  await drawPeople();
  const editor = await editorOf("ada@example.com");
  expect(
    within(within(editor).getByRole("table", { name: "Projects" }))
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toStrictEqual(["Projects", "Admin", "Developer", "Dispatcher"]);
  expect(boxesIn(editor, "atlas")).toStrictEqual([
    "atlas Admin+",
    "atlas Developer+",
    "atlas Dispatcher",
  ]);
});

test("a reader who may grant Member alone is offered Member, and sees the rest as it is held", async () => {
  await drawPeople({
    abilities: () => answer({ ...peopleAbilitiesNone, roles: ["Member"] }),
  });
  const ada = await editorOf("ada@example.com");
  expect(boxesIn(ada, "Workspace")).toStrictEqual([
    "(Admin+)",
    "Member",
    "(Hosted runs+)",
  ]);
  expect(boxesIn(ada, "atlas")).toStrictEqual([
    "(atlas Admin+)",
    "(atlas Developer+)",
  ]);
  expect(projectsOffered(ada)).toStrictEqual(["atlas"]);
  await press("Done");
  const bob = await editorOf("s-bob");
  expect(boxesIn(bob, "Workspace")).toStrictEqual(["Member+"]);
  expect(projectsOffered(bob)).toStrictEqual([]);
});

test("a reader who may grant on one project of two is offered its roles, and sees the other's as held", async () => {
  await drawPeople({
    abilities: () =>
      answer({
        ...peopleAbilitiesNone,
        projects: peopleAbilitiesAll(["beacon"]).projects,
      }),
  });
  const offered = ["beacon Admin", "beacon Developer", "beacon Dispatcher"];
  const ada = await editorOf("ada@example.com");
  expect(boxesIn(ada, "atlas")).toStrictEqual([
    "(atlas Admin+)",
    "(atlas Developer+)",
  ]);
  expect(boxesIn(ada, "beacon")).toStrictEqual(offered);
  await press("Done");
  expect(boxesIn(await editorOf("s-bob"), "beacon")).toStrictEqual(offered);
});

test("a held box the reader may not change takes no press", async () => {
  const drawn = await drawPeople({
    abilities: () => answer({ ...peopleAbilitiesNone, roles: ["Member"] }),
  });
  const editor = await editorOf("ada@example.com");
  await boxPressed(editor, "Admin");
  await boxPressed(editor, "atlas Developer");
  expect(changesSent(drawn)).toStrictEqual([]);
});

test("a reader who may change nothing sees what each person holds, and no Edit and no Invite", async () => {
  await drawPeople({ abilities: () => answer(peopleAbilitiesNone) });
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(heldIn(personRow("ada@example.com"))).toStrictEqual([
    "Admin",
    "Hosted runs",
  ]);
  expect(projectsIn(personRow("ada@example.com"))).toStrictEqual([
    "atlas: Admin, Developer",
  ]);
});

test("abilities absent beside a list that was answered leave the tables without controls, and draw one line under them", async () => {
  await drawPeople({ abilities: () => answer({}, 404) });
  expect(personRow("ada@example.com")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.getAllByText(/^Not available/u)).toHaveLength(1);
});

test("a reader who may give hosted runs is offered them on every person, checked where held", async () => {
  await drawPeople();
  const drawn: string[] = [];
  for (const name of ["ada@example.com", "s-bob", "s-selector"]) {
    drawn.push(...boxesIn(await editorOf(name), "Workspace").slice(-1));
    await press("Done");
  }
  expect(drawn).toStrictEqual(["Hosted runs+", "Hosted runs", "Hosted runs+"]);
});

test("giving hosted runs sends the grant with no body, and reads the list and the abilities again", async () => {
  const drawn = await drawPeople();
  const read = listReads(drawn);
  const abilitiesRead = abilitiesReads(drawn);
  await boxPressed(await editorOf("s-bob"), "Hosted runs");
  expect(changesSent(drawn)).toStrictEqual([
    { method: "POST", url: hostedRunsPath("s-bob"), body: undefined },
  ]);
  expect(listReads(drawn)).toBe(read + 1);
  expect(abilitiesReads(drawn)).toBe(abilitiesRead + 1);
});

test("taking hosted runs from a person with an account sends the removal at once", async () => {
  const drawn = await drawPeople();
  await boxPressed(await editorOf("ada@example.com"), "Hosted runs");
  expect(screen.queryByRole("group", { name: "Remove hosted runs" })).toBe(
    null,
  );
  expect(changesSent(drawn)).toStrictEqual([
    { method: "DELETE", url: hostedRunsPath("s-ada"), body: undefined },
  ]);
});

test("taking hosted runs from a subject with no account asks first, and Remove sends the removal", async () => {
  const drawn = await drawPeople();
  const editor = await editorOf("s-selector");
  await boxPressed(editor, "Hosted runs");
  const asked = within(editor).getByRole("group", {
    name: "Remove hosted runs",
  });
  expect(
    within(asked).getByText("Runs this identity starts will stop."),
  ).toBeTruthy();
  expect(changesSent(drawn)).toStrictEqual([]);
  expect(
    within(editor)
      .getAllByRole("checkbox")
      .every((box) => box.hasAttribute("disabled")),
  ).toBe(true);
  await press("Remove");
  expect(changesSent(drawn)).toStrictEqual([
    { method: "DELETE", url: hostedRunsPath("s-selector"), body: undefined },
  ]);
});

test("cancelling the question on a subject with no account sends nothing and leaves hosted runs checked", async () => {
  const drawn = await drawPeople();
  const editor = await editorOf("s-selector");
  await boxPressed(editor, "Hosted runs");
  await press("Cancel");
  expect(changesSent(drawn)).toStrictEqual([]);
  expect(screen.queryByRole("group", { name: "Remove hosted runs" })).toBe(
    null,
  );
  expect(boxesIn(editor, "Workspace")).toContain("Hosted runs+");
});

test("refused hosted runs draw the line in the person's editor", async () => {
  await drawPeople({ changed: () => refused(403, "AccessNotPermitted") });
  const editor = await editorOf("s-bob");
  await boxPressed(editor, "Hosted runs");
  expect(within(editor).getByText("Change not permitted")).toBeTruthy();
  expect(boxesIn(editor, "Workspace")).toContain("Hosted runs");
});

test("a reader who may not give hosted runs sees them where held, as a box no press changes", async () => {
  const drawn = await drawPeople({
    abilities: () =>
      answer({ ...peopleAbilitiesAll(), grantHostedRuns: false }),
  });
  const ada = await editorOf("ada@example.com");
  expect(boxesIn(ada, "Workspace")).toStrictEqual([
    "Admin+",
    "Member",
    "(Hosted runs+)",
  ]);
  await boxPressed(ada, "Hosted runs");
  expect(changesSent(drawn)).toStrictEqual([]);
  await press("Done");
  expect(boxesIn(await editorOf("s-bob"), "Workspace")).toStrictEqual([
    "Admin",
    "Member+",
  ]);
});

test("a reader who may not give hosted runs, and one whose abilities are not read, see them as a chip where held", async () => {
  for (const abilities of [
    () => answer(peopleAbilitiesNone),
    () => answer({}, 404),
  ]) {
    await drawPeople({ abilities });
    expect(screen.queryByRole("button", { name: /^Edit/u })).toBeNull();
    expect(heldIn(personRow("ada@example.com"))).toContain("Hosted runs");
    expect(heldIn(personRow("s-bob"))).not.toContain("Hosted runs");
    expect(heldIn(personRow("s-selector"))).toStrictEqual(["Hosted runs"]);
    cleanup();
  }
});
