/**
 * What became of each of a workspace's invite links, on its people page: a
 * section between the people and the other identities, a row a link in the
 * plane's order saying what it carries, where it stands, who used it and who
 * made it, and a revocation offered only on an open link the reader may end.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInviteLinkEndedCode,
  accessNotPermittedCode,
  type AccessInviteLinks,
} from "../../../../src/contract/accessPlane.ts";
import { instantText } from "../../app/core/figures.ts";
import {
  answer,
  heldAnswer,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import {
  changesSent,
  drawPeople,
  heldIn,
  linkListed,
  linkPath,
  linksListed,
  linksReads,
  listReads,
  noContent,
  peopleAbilitiesAll,
  peopleAbilitiesNone,
  peopleTenant,
  projectsIn,
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

function table(): HTMLElement {
  return screen.getByRole("table", { name: "Invite links" });
}

/** The table's rows under its head, a link each and under one the row its revocation asks in. */
function rows(): readonly HTMLElement[] {
  return within(table()).getAllByRole("row").slice(1);
}

/** What each column of one row draws, by the column's own heading. */
function cells(row: HTMLElement): Readonly<Record<string, HTMLElement>> {
  const headings = within(table())
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent);
  const drawn = [
    within(row).getByRole("rowheader"),
    ...within(row).getAllByRole("cell"),
  ];
  return Object.fromEntries(
    drawn.map((cell, index) => [headings[index] ?? "", cell]),
  );
}

function statuses(): readonly (string | undefined)[] {
  return rows().map(
    (row) => cells(row)["Status"]?.querySelector(".pill")?.textContent,
  );
}

function when(atMs: number): string {
  return instantText(new Date(atMs), new Date());
}

function revocations(): readonly (string | null)[] {
  return within(table())
    .queryAllByRole("button", { name: "Revoke" })
    .map((button) => button.closest("tr")?.textContent ?? null);
}

const [opened, used, revoked, expired] = linksListed.links;

test("the links are a section under the people and over the other identities, a row a link in the plane's order", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toStrictEqual(["1 person", "Invite links", "Other identities"]);
  expect(statuses()).toStrictEqual(["Open", "Used", "Revoked", "Expired"]);
  expect(
    within(table())
      .getAllByRole("columnheader")
      .map((heading) => heading.textContent),
  ).toStrictEqual(["Access", "Status", "Used by", "Made by", "Revoke"]);
  styleless();
});

test("a row is headed by what its link carries, drawn as a person's row draws what they hold", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  const [open, , ended] = rows();
  if (open === undefined || ended === undefined) throw new Error("no rows");
  const access = cells(open)["Access"];
  if (access === undefined) throw new Error("no access");
  expect(heldIn(access)).toStrictEqual(["Member"]);
  expect(projectsIn(access)).toStrictEqual([
    "beacon: Developer, Viewer",
    "atlas: Dispatcher",
  ]);
  const admin = cells(ended)["Access"];
  if (admin === undefined) throw new Error("no access");
  expect(heldIn(admin)).toStrictEqual(["Admin"]);
  expect(within(admin).getByText("All projects")).toBeTruthy();
});

test("an open link says when it expires, and no other state does", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(rows().map((row) => cells(row)["Status"]?.textContent)).toStrictEqual([
    `OpenExpires ${when(opened?.expiresAtMs ?? 0)}`,
    "Used",
    "Revoked",
    "Expired",
  ]);
});

test("a used link names who used it and when, a subject the directory cannot name drawn as itself", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  const row = rows()[1];
  if (row === undefined || used?.state !== "Used") throw new Error("no row");
  const by = cells(row)["Used by"];
  expect(by?.querySelector(".identity")?.textContent).toBe("s-grace");
  expect(by?.textContent).toBe(`Used bys-grace${when(used.usedAtMs)}`);
  expect(by?.hasAttribute("data-none")).toBe(false);
});

test("a link nobody used draws the none-mark where a stacked row leaves the cell out", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  for (const row of [rows()[0], rows()[2], rows()[3]]) {
    const by = row === undefined ? undefined : cells(row)["Used by"];
    expect(by?.textContent).toBe("—None");
    expect(by?.getAttribute("data-none")).toBe("");
  }
});

test("every link names who made it and when, an account by its address and login", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(rows().map((row) => cells(row)["Made by"]?.textContent)).toStrictEqual(
    [opened, used, revoked, expired].map(
      (link) => `Made byada@example.comada${when(link?.mintedAtMs ?? 0)}`,
    ),
  );
});

test("the two columns that name a person carry their words for a stacked row, and no other cell does", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(
    rows().map((row) =>
      Array.from(row.querySelectorAll(".people-stacked-label")).map(
        (label) => label.textContent,
      ),
    ),
  ).toStrictEqual([
    ["Made by"],
    ["Used by", "Made by"],
    ["Made by"],
    ["Made by"],
  ]);
});

test("Revoke is offered on an open link the reader may grant every role of, and on no other", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(revocations().length).toBe(1);
  expect(within(rows()[0] ?? table()).getByRole("button").textContent).toBe(
    "Revoke",
  );
});

test("a link carrying a role the reader may not grant draws no Revoke, and a table with none draws no column for it", async () => {
  const short = peopleAbilitiesAll(["beacon"]);
  await drawPeople({
    links: () => answer(linksListed),
    abilities: () => answer(short),
  });
  expect(revocations()).toStrictEqual([]);
  expect(
    within(table())
      .getAllByRole("columnheader")
      .map((heading) => heading.textContent),
  ).toStrictEqual(["Access", "Status", "Used by", "Made by"]);
});

test("a reader who may grant nothing, and one whose abilities are not read, are offered no Revoke", async () => {
  await drawPeople({
    links: () => answer(linksListed),
    abilities: () => answer(peopleAbilitiesNone),
  });
  expect(revocations()).toStrictEqual([]);
  cleanup();
  await drawPeople({
    links: () => answer(linksListed),
    abilities: () => answer({}, 404),
  });
  expect(revocations()).toStrictEqual([]);
});

const two: AccessInviteLinks = {
  links: [linkListed("l-one"), linkListed("l-two", { role: "Admin" })],
};

/** A list of two open links, the first read again as revoked once a revocation is answered. */
function revoking(changed: () => Response | Promise<Response>): {
  readonly links: () => Response;
  readonly changed: () => Response | Promise<Response>;
} {
  let answered = false;
  return {
    links: () =>
      answer(
        answered
          ? { links: [linkListed("l-one", { state: "Revoked" }), two.links[1]] }
          : two,
      ),
    changed: async () => {
      const response = await changed();
      answered = true;
      return response;
    },
  };
}

function question(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Revoke link" });
}

test("Revoke asks first, in the row under its link, and Cancel sends nothing", async () => {
  const drawn = await drawPeople(revoking(noContent));
  await turned(() => {
    fireEvent.click(within(rows()[0] ?? table()).getByRole("button"));
  });
  expect(question()?.closest("tr")).toBe(rows()[1]);
  expect(question()?.textContent).toContain("This link will stop working.");
  expect(
    within(table())
      .getAllByRole<HTMLButtonElement>("button", { name: "Revoke" })
      .filter((button) => question()?.contains(button) !== true)
      .map((button) => button.disabled),
  ).toStrictEqual([true, true]);
  await press("Cancel");
  expect(question()).toBeNull();
  expect(changesSent(drawn)).toStrictEqual([]);
  expect(statuses()).toStrictEqual(["Open", "Open"]);
  styleless();
});

/** The first link's Revoke pressed and its question confirmed. */
async function revokedFirst(): Promise<void> {
  await turned(() => {
    fireEvent.click(within(rows()[0] ?? table()).getByRole("button"));
  });
  const asked = question();
  if (asked === null) throw new Error("nothing asked");
  await turned(() => {
    fireEvent.click(within(asked).getByRole("button", { name: "Revoke" }));
  });
}

test("a revocation confirmed sends that link's removal alone and reads the links again, and the people not at all", async () => {
  const drawn = await drawPeople(revoking(noContent));
  const before = { links: linksReads(drawn), people: listReads(drawn) };
  await revokedFirst();
  await settled();
  expect(changesSent(drawn)).toStrictEqual([
    { method: "DELETE", url: linkPath("l-one"), body: undefined },
  ]);
  expect(linksReads(drawn)).toBe(before.links + 1);
  expect(listReads(drawn)).toBe(before.people);
  expect(statuses()).toStrictEqual(["Revoked", "Open"]);
  expect(question()).toBeNull();
  expect(revocations().length).toBe(1);
});

test("a link that ended meanwhile is read again and nothing is said", async () => {
  const drawn = await drawPeople(
    revoking(() => refused(409, accessInviteLinkEndedCode)),
  );
  const before = linksReads(drawn);
  await revokedFirst();
  await settled();
  expect(linksReads(drawn)).toBe(before + 1);
  expect(statuses()).toStrictEqual(["Revoked", "Open"]);
  expect(within(table()).queryByRole("status")).toBeNull();
  expect(question()).toBeNull();
});

test("a revocation the plane refuses draws its line under that link's row, gone at the next press", async () => {
  const drawn = await drawPeople({
    links: () => answer(two),
    changed: () => refused(403, accessNotPermittedCode),
  });
  const before = linksReads(drawn);
  await revokedFirst();
  await settled();
  expect(linksReads(drawn)).toBe(before + 1);
  const said = within(table()).getByRole("status");
  expect(said.textContent).toBe("Change not permitted");
  expect(said.closest("tr")).toBe(rows()[1]);
  expect(question()).toBeNull();
  await turned(() => {
    fireEvent.click(within(rows()[2] ?? table()).getByRole("button"));
  });
  expect(within(table()).queryByRole("status")).toBeNull();
});

test("a revocation unanswered, its Cancel is gone and no other Revoke takes a press", async () => {
  const held = heldAnswer();
  await drawPeople(revoking(() => held.answered));
  await revokedFirst();
  const asked = question();
  if (asked === null) throw new Error("nothing asked");
  expect(within(asked).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(
    within(table())
      .getAllByRole<HTMLButtonElement>("button", { name: "Revoke" })
      .map((button) => button.disabled),
  ).toStrictEqual([true, true, true]);
  await turned(() => {
    held.release(noContent());
  });
  await settled();
  expect(statuses()).toStrictEqual(["Revoked", "Open"]);
});
