/**
 * What became of each of the site's workspace links, on its workspaces page:
 * a section under the workspaces, a row a link in the plane's order saying
 * the note it was made with, where it stands, the workspace it made and who
 * made it, and a revocation offered only on an open link the reader was
 * granted what making it asked.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInviteLinkEndedCode,
  accessNotPermittedCode,
  type AccessWorkspaceLinks,
} from "../../../../src/contract/accessPlane.ts";
import { answer, press, settled } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import {
  linkCells,
  linkColumn,
  linkHeadings,
  linkRevocations,
  linkRows,
  linkStackedLabels,
  linkStatuses,
  linksTable,
  linkWhen,
  revocationAsked,
  revocationQuestion,
  revocationQuestionSpans,
  revokedFirst,
} from "./inviteLinksTable.ts";
import { permissionsTenant } from "./permissionsFixture.tsx";
import {
  creationsSent,
  drawWorkspaces,
  siteWorkspaceLinkPath,
  workspaceLinkListed,
  workspaceLinksListed,
  workspaceLinksReads,
  workspaceListReads,
  workspacesAbilitiesCreator,
} from "./siteWorkspacesFixture.tsx";
import type { WorkspacesDrawing } from "./siteWorkspacesFixture.tsx";
import { noContent, refused } from "./tenantPeopleFixture.tsx";

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
  useParams: () => ({ tenant: permissionsTenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const listed: WorkspacesDrawing = { links: () => answer(workspaceLinksListed) };

const [opened, used, revoked, expired] = workspaceLinksListed.links;

test("the links are a section under the workspaces, a row a link in the plane's order", async () => {
  await drawWorkspaces(listed);
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toStrictEqual(["4 workspaces", "Invite links"]);
  expect(linkStatuses()).toStrictEqual(["Open", "Used", "Revoked", "Expired"]);
  expect(linkHeadings()).toStrictEqual([
    "Note",
    "Status",
    "Workspace",
    "Made by",
    "Revoke",
  ]);
  styleless();
});

test("a row is headed by its link's note or the none-mark, and says under it where the link hands account creation on", async () => {
  await drawWorkspaces(listed);
  expect(linkColumn("Note")).toStrictEqual([
    "For the Lisbon teamCan invite new people",
    "Sent to Grace",
    "—None",
    "—NoneCan invite new people",
  ]);
});

test("whether a link admits a new account is not drawn", async () => {
  await drawWorkspaces({
    links: () =>
      answer({ links: [workspaceLinkListed("w-one", { newAccounts: false })] }),
  });
  expect(linksTable().textContent).not.toContain("Existing accounts");
  expect(linkColumn("Note")).toStrictEqual(["—None"]);
});

test("an open link says when it expires, and no other state does", async () => {
  await drawWorkspaces(listed);
  expect(linkColumn("Status")).toStrictEqual([
    `OpenExpires ${linkWhen(opened?.expiresAtMs ?? 0)}`,
    "Used",
    "Revoked",
    "Expired",
  ]);
});

test("a used link names the workspace it made, then who used it and when, a subject the directory cannot name drawn as itself", async () => {
  await drawWorkspaces(listed);
  const row = linkRows()[1];
  if (row === undefined || used?.state !== "Used") throw new Error("no row");
  const made = linkCells(row)["Workspace"];
  expect(made?.textContent).toBe(
    `Workspacenorthwinds-grace${linkWhen(used.usedAtMs)}`,
  );
  const name = made?.querySelector(".people-name");
  expect(name?.textContent).toBe("northwind");
  expect(name?.getAttribute("title")).toBe("northwind");
  expect(made?.querySelector(".identity")?.textContent).toBe("s-grace");
  expect(made?.hasAttribute("data-none")).toBe(false);
});

test("a link nobody used draws the none-mark where a stacked row leaves the cell out", async () => {
  await drawWorkspaces(listed);
  for (const row of [linkRows()[0], linkRows()[2], linkRows()[3]]) {
    const made = row === undefined ? undefined : linkCells(row)["Workspace"];
    expect(made?.textContent).toBe("—None");
    expect(made?.getAttribute("data-none")).toBe("");
  }
});

test("every link names who made it and when", async () => {
  await drawWorkspaces(listed);
  expect(linkColumn("Made by")).toStrictEqual(
    [opened, used, revoked, expired].map(
      (link) => `Made byada@example.comada${linkWhen(link?.mintedAtMs ?? 0)}`,
    ),
  );
});

test("the workspace a link made and who made the link carry their column's words for a stacked row, and no other cell does", async () => {
  await drawWorkspaces(listed);
  expect(linkStackedLabels()).toStrictEqual([
    ["Made by"],
    ["Workspace", "Made by"],
    ["Made by"],
    ["Made by"],
  ]);
});

test("Revoke is offered on an open link and on no other", async () => {
  await drawWorkspaces(listed);
  expect(linkRevocations().length).toBe(1);
  expect(
    within(linkRows()[0] ?? linksTable()).getByRole("button").textContent,
  ).toBe("Revoke");
});

const two: AccessWorkspaceLinks = {
  links: [
    workspaceLinkListed("w-one", { note: "plain" }),
    workspaceLinkListed("w-two", { note: "hands on", createAccounts: true }),
  ],
};

test("a link that hands account creation on draws no Revoke to a reader who does not manage the site's permissions, and one that does not is theirs to end", async () => {
  await drawWorkspaces({
    abilities: () => answer(workspacesAbilitiesCreator),
    links: () => answer(two),
  });
  expect(
    linkRows().map(
      (row) => within(row).queryByRole("button", { name: "Revoke" }) !== null,
    ),
  ).toStrictEqual([true, false]);
});

test("a table with no link the reader may end draws no column for it", async () => {
  await drawWorkspaces({
    abilities: () => answer(workspacesAbilitiesCreator),
    links: () => answer({ links: [two.links[1]] }),
  });
  expect(linkRevocations()).toStrictEqual([]);
  expect(linkHeadings()).toStrictEqual([
    "Note",
    "Status",
    "Workspace",
    "Made by",
  ]);
});

/** A list of two open links, the first read again as revoked once a revocation is answered. */
function revoking(answered: () => Response): WorkspacesDrawing {
  let ended = false;
  return {
    links: () =>
      answer(
        ended
          ? {
              links: [
                workspaceLinkListed("w-one", { state: "Revoked" }),
                two.links[1],
              ],
            }
          : two,
      ),
    linked: () => {
      ended = true;
      return answered();
    },
  };
}

test("Revoke asks first, in the row under its link, and Cancel sends nothing", async () => {
  const drawn = await drawWorkspaces(revoking(noContent));
  await revocationAsked(0);
  expect(revocationQuestion()?.closest("tr")).toBe(linkRows()[1]);
  expect(revocationQuestionSpans()).toBe(true);
  await press("Cancel");
  expect(revocationQuestion()).toBeNull();
  expect(creationsSent(drawn)).toStrictEqual([]);
  expect(linkStatuses()).toStrictEqual(["Open", "Open"]);
});

test("a revocation confirmed sends that link's removal to the site's route and reads the links again, and the workspaces not at all", async () => {
  const drawn = await drawWorkspaces(revoking(noContent));
  const before = {
    links: workspaceLinksReads(drawn),
    workspaces: workspaceListReads(drawn),
  };
  await revokedFirst();
  await settled();
  expect(creationsSent(drawn)).toStrictEqual([
    { method: "DELETE", url: siteWorkspaceLinkPath("w-one"), body: undefined },
  ]);
  expect(workspaceLinksReads(drawn)).toBe(before.links + 1);
  expect(workspaceListReads(drawn)).toBe(before.workspaces);
  expect(linkStatuses()).toStrictEqual(["Revoked", "Open"]);
});

test("a workspace link that ended meanwhile is read again and nothing is said", async () => {
  const drawn = await drawWorkspaces(
    revoking(() => refused(409, accessInviteLinkEndedCode)),
  );
  const reads = workspaceLinksReads(drawn);
  await revokedFirst();
  await settled();
  expect(workspaceLinksReads(drawn)).toBe(reads + 1);
  expect(linkStatuses()).toStrictEqual(["Revoked", "Open"]);
  expect(screen.queryByRole("status")).toBeNull();
});

test("a revocation the plane refuses draws its line under that link's row", async () => {
  await drawWorkspaces({
    links: () => answer(two),
    linked: () => refused(403, accessNotPermittedCode),
  });
  await revokedFirst();
  await settled();
  const said = within(linksTable()).getByRole("status");
  expect(said.textContent).toBe("Change not permitted");
  expect(said.closest("tr")).toBe(linkRows()[1]);
});

test("a site that keeps links and has none draws no section of them", async () => {
  await drawWorkspaces({ links: () => answer({ links: [] }) });
  expect(screen.queryByText("Invite links")).toBeNull();
  expect(screen.queryByRole("table", { name: "Invite links" })).toBeNull();
});
