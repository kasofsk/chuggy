/**
 * The project's permissions page, mounted in the project's frame: one section,
 * a row a permission naming its holders, every holder removable and every
 * permission given `Add` by the workspace page's own section and dialog, the
 * project's routes sent and its list and people read again, and the absent
 * list one line.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, press, sectionOf, turned } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  addButtons,
  added,
  additionsSent,
  choicesOffered,
  chosen,
  dialog,
  drawProjectPermissions,
  opened,
  permissionsDrawn,
  permissionsProject,
  permissionsTenant,
  projectAuthoritiesPath,
  projectAuthoritiesStarting,
  projectPeoplePath,
  readsOf,
  removalsSent,
  removeButtons,
  unanswered,
} from "./permissionsFixture.tsx";

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
  useParams: () => ({ tenant: permissionsTenant, project: permissionsProject }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const [
  adminGranters,
  developerGranters,
  dispatcherGranters,
  viewerGranters,
  authorityManagers,
] = projectAuthoritiesStarting.authorities;

const startingHolders = ["Workspace admins", "Project admins"];

test("a project manager sees its five permissions in roster order, each with Add and each holder removable", async () => {
  await drawProjectPermissions();
  expect(screen.getByRole("heading", { name: "Permissions" })).toBeTruthy();
  expect(permissionsDrawn("Project")).toStrictEqual([
    { name: "Grant Admin", holders: startingHolders },
    { name: "Grant Developer", holders: startingHolders },
    { name: "Grant Dispatcher", holders: startingHolders },
    { name: "Grant Viewer", holders: startingHolders },
    { name: "Change permissions", holders: startingHolders },
  ]);
  expect(addButtons("Project")).toStrictEqual([
    "Add to Grant Admin",
    "Add to Grant Developer",
    "Add to Grant Dispatcher",
    "Add to Grant Viewer",
    "Add to Change permissions",
  ]);
  expect(removeButtons("Project")).toStrictEqual(
    [
      "Grant Admin",
      "Grant Developer",
      "Grant Dispatcher",
      "Grant Viewer",
      "Change permissions",
    ].flatMap((permission) =>
      startingHolders.map((holder) => `Remove ${holder} from ${permission}`),
    ),
  );
});

test("a reader the project's list is absent to sees the one line and no table", async () => {
  await drawProjectPermissions({ authorities: () => answer({}, 404) });
  const section = sectionOf("Project");
  expect(
    within(section).getByText("A project admin manages permissions"),
  ).toBeTruthy();
  expect(within(section).queryByRole("table")).toBeNull();
  expect(screen.queryByText(/^Not available/u)).toBeNull();
});

test("the project's read loading or failed is its unready line, and a cut list says so", async () => {
  await drawProjectPermissions({ authorities: unanswered });
  expect(within(sectionOf("Project")).getByText("Loading…")).toBeTruthy();
  cleanup();
  await drawProjectPermissions({ authorities: () => answer({}, 500) });
  expect(
    within(sectionOf("Project")).getByText(
      "Failed to load · the API failed with InternalError",
    ),
  ).toBeTruthy();
  cleanup();
  await drawProjectPermissions({
    authorities: () =>
      answer({ ...projectAuthoritiesStarting, truncated: true }),
  });
  expect(within(sectionOf("Project")).getByText("List cut short")).toBeTruthy();
});

const projectReads = [projectAuthoritiesPath, projectPeoplePath];

const ada = {
  subject: "s-ada",
  mine: false,
  account: true,
  email: "ada@example.com",
};

test.each([
  {
    holder: "Remove Project admins from Grant Developer",
    path: `${projectAuthoritiesPath}/DeveloperGranters/groups/ProjectAdmins`,
  },
  {
    holder: "Remove ada@example.com from Grant Admin",
    path: `${projectAuthoritiesPath}/AdminGranters/people/s-ada`,
  },
])(
  "$holder sends the project's route with no body, then reads its list and its people again",
  async ({ holder, path }) => {
    const drawn = await drawProjectPermissions({
      authorities: () =>
        answer({
          ...projectAuthoritiesStarting,
          authorities: [
            { ...adminGranters, people: [ada] },
            developerGranters,
            dispatcherGranters,
            authorityManagers,
          ],
        }),
    });
    const before = projectReads.map((read) => readsOf(drawn, read));
    await press(holder);
    expect(removalsSent(drawn)).toStrictEqual([
      { method: "DELETE", url: path, body: undefined },
    ]);
    expect(
      projectReads.map(
        (read, index) => readsOf(drawn, read) > (before[index] ?? 0),
      ),
    ).toStrictEqual([true, true]);
  },
);

test("removing a holder of Change permissions asks first and sends nothing until confirmed", async () => {
  const drawn = await drawProjectPermissions();
  await press("Remove Project admins from Change permissions");
  const asked = screen.getByRole("group", {
    name: "Remove permission manager",
  });
  expect(
    within(asked).getByText("This may lock people out of this page."),
  ).toBeTruthy();
  expect(removalsSent(drawn)).toStrictEqual([]);
  await press("Remove");
  expect(removalsSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `${projectAuthoritiesPath}/AuthorityManagers/groups/ProjectAdmins`,
      body: undefined,
    },
  ]);
});

test("each permission offers its record's groups less those held, Project developers on Grant Developer and Grant Viewer", async () => {
  await drawProjectPermissions();
  await opened("Project", "Grant Developer");
  expect(choicesOffered()).toStrictEqual([
    "Site admins",
    "Project developers",
    "Person",
  ]);
  await press("Cancel");
  await opened("Project", "Grant Viewer");
  expect(choicesOffered()).toStrictEqual([
    "Site admins",
    "Project developers",
    "Person",
  ]);
  await press("Cancel");
  await opened("Project", "Grant Admin");
  expect(choicesOffered()).toStrictEqual(["Site admins", "Person"]);
  await press("Cancel");
  await opened("Project", "Change permissions");
  expect(choicesOffered()).toStrictEqual(["Person"]);
});

test("Project developers on Grant Developer draws its line, Person its own, and adding sends the group's route and reads again", async () => {
  const drawn = await drawProjectPermissions();
  await opened("Project", "Grant Developer");
  const line = within(dialog()).getByText(
    "Developers will see people and can remove other developers.",
  );
  const developers = within(dialog()).getByRole("radio", {
    name: "Project developers",
  });
  expect(developers.getAttribute("aria-describedby")).toBe(line.id);
  expect(within(dialog()).getByText("From this project's people")).toBeTruthy();
  const before = projectReads.map((read) => readsOf(drawn, read));
  await chosen("Project developers");
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${projectAuthoritiesPath}/DeveloperGranters/groups/ProjectDevelopers`,
      body: undefined,
    },
  ]);
  expect(screen.queryByRole("dialog", { name: "Add holder" })).toBeNull();
  expect(
    projectReads.map(
      (read, index) => readsOf(drawn, read) > (before[index] ?? 0),
    ),
  ).toStrictEqual([true, true]);
});

test("Project developers on Grant Viewer draws its own line, and not Grant Developer's", async () => {
  await drawProjectPermissions();
  await opened("Project", "Grant Viewer");
  const line = within(dialog()).getByText(
    "Developers will see people and can remove viewers.",
  );
  expect(
    within(dialog())
      .getByRole("radio", { name: "Project developers" })
      .getAttribute("aria-describedby"),
  ).toBe(line.id);
  expect(
    within(dialog()).queryByText(
      "Developers will see people and can remove other developers.",
    ),
  ).toBeNull();
});

test("a person is chosen among the project's people less those holding the permission, and sent with their subject", async () => {
  const drawn = await drawProjectPermissions({
    authorities: () =>
      answer({
        ...projectAuthoritiesStarting,
        authorities: [
          adminGranters,
          developerGranters,
          { ...dispatcherGranters, people: [ada] },
          viewerGranters,
          authorityManagers,
        ],
      }),
  });
  await opened("Project", "Grant Dispatcher");
  await chosen("Person");
  expect(
    within(dialog())
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toStrictEqual(["s-bobNo accountChoose s-bob"]);
  await turned(() => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Choose s-bob" }),
    );
  });
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${projectAuthoritiesPath}/DispatcherGranters/people/s-bob`,
      body: undefined,
    },
  ]);
});
