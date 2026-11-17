/**
 * The welcome page a signed-in reader with no project lands on at the root,
 * over each place they may stand: admin of a workspace, a plain member of
 * one, or in none. Each is drawn the folded setup prompt and the line saying
 * what pasting it does, and no form; each is told where they stand, and the
 * GitHub login their account records is said where a workspace's people list
 * answers it.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type {
  AccessCallerTenant,
  AccessTenantPerson,
} from "../../../src/contract/accessPlane.ts";
import { Landing } from "../app/browser/routes.tsx";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  claudeCodeLine,
  claudeCodeLineAbout,
  claudeCodeLineCopy,
} from "../app/core/claudeCodeLine.ts";
import { administered, drawn, joined } from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, press } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

const site = vi.hoisted(() => ({
  origin: "https://chuggy.test",
  copied: [] as string[],
}));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => site.origin,
  clipboardWritten: (text: string) => {
    site.copied.push(text);
    return Promise.resolve(true);
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(() => {
  resizeObserverStubbed();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  site.copied.length = 0;
  vi.unstubAllGlobals();
});

function person(
  subject: string,
  githubLogin: string,
  admin: boolean,
  mine = false,
): AccessTenantPerson {
  return {
    subject,
    mine,
    tenantRoles: admin ? ["Admin"] : ["Member"],
    hostedRuns: false,
    personalRunners: false,
    unscopedChat: true,
    projects: [],
    account: true,
    email: `${subject}@example.test`,
    githubLogin,
  };
}

/** A plane with no project for the reader, listing these workspaces, and
 * answering each one's people list where `people` names it and refusing it
 * otherwise. The URLs it was asked are kept. */
function servedWelcome(
  tenants: readonly AccessCallerTenant[],
  people: Readonly<Record<string, readonly AccessTenantPerson[]>> = {},
): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url);
    if (url === "/access/v1/workspaces")
      return Promise.resolve(answer({ tenants, truncated: false }));
    const listed = /^\/access\/v1\/tenants\/([^/]+)\/people$/u.exec(url);
    if (listed !== null) {
      const tenant = listed[1] ?? "";
      const roster = people[tenant];
      return Promise.resolve(
        roster === undefined
          ? answer({}, 404)
          : answer({
              tenant,
              projects: [],
              people: roster,
              otherIssuers: 0,
              truncated: false,
            }),
      );
    }
    if (url.startsWith("/access/")) return Promise.resolve(answer({}, 404));
    return Promise.resolve(answer({ projects: [] }));
  });
  return asked;
}

/** What every place a reader may stand is drawn alike: the page's heading,
 * the folded prompt with its control, the line saying what pasting it does,
 * and no form. */
function welcomeDrawn(): void {
  expect(
    screen.getByRole("heading", { level: 1, name: "Welcome to chuggy" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: copyTextEn(claudeCodeLineAbout) }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: copyTextEn(claudeCodeLineCopy) }),
  ).toBeDefined();
  expect(document.querySelector("code")).toBeNull();
  expect(
    screen.getByText(
      "Paste it into Claude Code in the repository you want chuggy on. It walks you through the rest.",
    ),
  ).toBeDefined();
  expect(screen.queryAllByRole("textbox")).toStrictEqual([]);
  expect(screen.queryByRole("button", { name: "Create project" })).toBeNull();
}

test("an admin of a workspace with no project is told the workspace by its display name and who they are signed in as, and the prompt is their next step", async () => {
  servedWelcome(
    [{ ...administered("octocat-ws"), displayName: "octocat's Workspace" }],
    { "octocat-ws": [person("me", "octocat", true, true)] },
  );
  await drawn(<Landing />);
  welcomeDrawn();
  expect(
    screen.getByText("You are an admin of octocat's Workspace."),
  ).toBeDefined();
  expect(screen.getByText("Signed in as octocat on GitHub")).toBeDefined();
  expect(screen.queryByText(/adds you to a project/u)).toBeNull();
  await press(copyTextEn(claudeCodeLineCopy));
  expect(site.copied).toStrictEqual([claudeCodeLine(site.origin)]);
});

test("a plain member with no project is told their workspace and role, that an admin adds them to a project, and who its admins are", async () => {
  servedWelcome([{ ...joined("harbour"), displayName: "Harbour Labs" }], {
    harbour: [
      person("me", "newcomer", false, true),
      person("ada", "ada-l", true),
      person("bob", "bobby", false),
      person("cy", "cy-admin", true),
    ],
  });
  await drawn(<Landing />);
  welcomeDrawn();
  expect(screen.getByText("In Harbour Labs as Member")).toBeDefined();
  expect(
    screen.getByText("A workspace admin adds you to a project."),
  ).toBeDefined();
  expect(screen.getByText("Admins: ada-l, cy-admin")).toBeDefined();
  expect(screen.getByText("Signed in as newcomer on GitHub")).toBeDefined();
  expect(screen.queryByText(/^You are an admin/u)).toBeNull();
});

test("a plain member whose workspace's people are withheld from them is still told where they stand, and names no admin and no account", async () => {
  servedWelcome([joined("harbour"), joined("zephyr")]);
  await drawn(<Landing />);
  welcomeDrawn();
  expect(screen.getByText("In harbour as Member")).toBeDefined();
  expect(screen.getByText("In zephyr as Member")).toBeDefined();
  expect(
    screen.getByText("A workspace admin adds you to a project."),
  ).toBeDefined();
  expect(screen.queryByText(/^Admins:/u)).toBeNull();
  expect(screen.queryByText(/^Signed in as/u)).toBeNull();
});

test("a reader in no workspace is told so in the setup program's words, and that a signup link makes them one, and no people list is asked", async () => {
  const asked = servedWelcome([]);
  await drawn(<Landing />);
  welcomeDrawn();
  expect(
    screen.getByText(copyTextEn({ id: "setup-mend-workspace-none" })),
  ).toBeDefined();
  expect(
    screen.getByText("A signup link from a site admin makes you one."),
  ).toBeDefined();
  expect(asked.filter((url) => url.endsWith("/people"))).toStrictEqual([]);
});
