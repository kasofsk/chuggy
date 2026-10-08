/**
 * The workspace's people page, mounted: a row a person, each role a button
 * pressed where the list holds it, one grant or removal a press, and one notice
 * for a reader the list is not answered to.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, press, sectionOf, settled } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  changesSent,
  drawPeople,
  listReads,
  peopleListed,
  peoplePath,
  peopleTenant,
  personRow,
  pressedIn,
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

/** One role's button, in the group a row holds it under: `Workspace`, or a project. */
function pressIn(row: HTMLElement, group: string, role: string): void {
  const scope = within(row).getByRole("group", { name: group });
  fireEvent.click(within(scope).getByRole("button", { name: role }));
}

test("a person is a row: an account by its email and login, the reader marked, and roles as the list holds them", async () => {
  await drawPeople();
  const ada = personRow("ada@example.com");
  expect(within(ada).getByText("ada")).toBeTruthy();
  expect(within(ada).getByText("You")).toBeTruthy();
  expect(within(ada).queryByText("No account")).toBeNull();
  expect(within(ada).getByText("Granted")).toBeTruthy();
  expect(pressedIn(ada)).toStrictEqual(["Admin", "Admin", "Developer"]);
  expect(
    pressedIn(within(ada).getByRole("group", { name: "atlas" })),
  ).toStrictEqual(["Admin", "Developer"]);
  expect(
    pressedIn(within(ada).getByRole("group", { name: "beacon" })),
  ).toStrictEqual([]);
  const bob = personRow("s-bob");
  expect(within(bob).getByText("No account")).toBeTruthy();
  expect(within(bob).queryByText("You")).toBeNull();
  expect(within(bob).getByText("Not granted")).toBeTruthy();
  expect(pressedIn(bob)).toStrictEqual(["Member"]);
  expect(screen.queryByRole("button", { name: /hosted/iu })).toBeNull();
});

test("an answer with no account field draws its subjects unmarked", async () => {
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
  expect(personRow("s-ada")).toBeTruthy();
  expect(personRow("s-bob")).toBeTruthy();
  expect(screen.queryByText("No account")).toBeNull();
});

test("a list holding only the reader draws that row, with nothing cut or counted", async () => {
  await drawPeople({
    listing: () =>
      answer({ ...peopleListed, people: peopleListed.people.slice(0, 1) }),
  });
  expect(screen.getAllByRole("row")).toHaveLength(2);
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
  await drawPeople({ listing: () => answer({}, 404) });
  expect(screen.getByText("A workspace admin manages people")).toBeTruthy();
  expect(within(sectionOf("People")).queryAllByRole("button")).toStrictEqual(
    [],
  );
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

test("granting a role sends that grant alone and reads the list again", async () => {
  const drawn = await drawPeople();
  const read = listReads(drawn);
  pressIn(personRow("s-bob"), "Workspace", "Admin");
  await settled();
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `/access/v1/tenants/${peopleTenant}/people/s-bob/roles`,
      body: { role: "Admin" },
    },
  ]);
  expect(listReads(drawn)).toBeGreaterThan(read);
});

test("removing a project role sends that removal alone, and a project admin asks nothing", async () => {
  const drawn = await drawPeople();
  const read = listReads(drawn);
  pressIn(personRow("ada@example.com"), "atlas", "Admin");
  await settled();
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `/access/v1/tenants/${peopleTenant}/projects/atlas/people/s-ada/roles/Admin`,
      body: undefined,
    },
  ]);
  expect(listReads(drawn)).toBeGreaterThan(read);
});

test("a refused change draws its line, and the control shows what the list holds", async () => {
  await drawPeople({ changed: () => refused(422, "SomethingNew") });
  const bob = personRow("s-bob");
  pressIn(bob, "Workspace", "Admin");
  await settled();
  expect(within(bob).getByText("Unknown refusal (SomethingNew)")).toBeTruthy();
  expect(pressedIn(bob)).toStrictEqual(["Member"]);
});

test("removing the only admin draws the conflict's sentence", async () => {
  await drawPeople({ changed: () => refused(409, "LastTenantAdministrator") });
  const bob = personRow("s-bob");
  pressIn(bob, "Workspace", "Member");
  await settled();
  expect(
    within(bob).getByText("Only admin · grant another first"),
  ).toBeTruthy();
});

test("removing the reader's own admin asks first, and declined sends nothing", async () => {
  const drawn = await drawPeople();
  pressIn(personRow("ada@example.com"), "Workspace", "Admin");
  await settled();
  expect(changesSent(drawn)).toStrictEqual([]);
  await press("Cancel");
  expect(changesSent(drawn)).toStrictEqual([]);
  expect(screen.queryByRole("group", { name: "Remove your admin role" })).toBe(
    null,
  );
});

test("removing the reader's own admin, once confirmed, sends it and draws the notice", async () => {
  let removed = false;
  const drawn = await drawPeople({
    listing: () => (removed ? answer({}, 404) : answer(peopleListed)),
    changed: () => {
      removed = true;
      return new Response(null, { status: 204 });
    },
  });
  pressIn(personRow("ada@example.com"), "Workspace", "Admin");
  await settled();
  await press("Remove");
  expect(changesSent(drawn).map((request) => request.url)).toStrictEqual([
    `${peoplePath}/s-ada/roles/Admin`,
  ]);
  expect(screen.getByText("A workspace admin manages people")).toBeTruthy();
  expect(within(sectionOf("People")).queryAllByRole("button")).toStrictEqual(
    [],
  );
});
