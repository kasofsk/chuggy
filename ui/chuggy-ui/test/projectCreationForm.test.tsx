/**
 * The landing a reader with no project meets, and the switcher entry that
 * reaches the same form, mounted over a plane that answers neither of the
 * form's reads, so its workspace is the free text a failed read leaves.
 *
 * What is asserted is the traffic as well as the words: a name the wire would
 * refuse sends nothing, and a press repeated after an answer that never arrived
 * goes under the identity the first one spent.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Landing } from "../app/browser/routes.tsx";
import {
  ProjectSwitcher,
  projectSwitcherCreateText,
} from "../app/browser/shell/ProjectSwitcher.tsx";
import { lastProjectRead } from "../app/core/lastProject.ts";
import {
  projectCreationRoutePath,
  projectNameRule,
} from "../app/core/projectCreation.ts";
import { persistentStore } from "../app/browser/ports.ts";
import {
  answerLine,
  drawn,
  pressed,
  ruleUnder,
  served,
  submit,
  typed,
} from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

const held = vi.hoisted(
  (): {
    went: unknown[];
    navigate: (to: unknown) => Promise<void>;
  } => {
    const went: unknown[] = [];
    return {
      went,
      navigate: (to: unknown): Promise<void> => {
        went.push(to);
        return Promise.resolve();
      },
    };
  },
);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => held.navigate,
}));
// jscpd:ignore-end -- the case's own doubles resume here

const partition = { tenant: "vteng", project: "chuggy" };

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(() => {
  resizeObserverStubbed();
  held.went.length = 0;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a reader with no project meets the form, under a bar that signs out and sets the theme", async () => {
  served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  expect(screen.getByText("No projects")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Workspace" })).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Project" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
    key: "ArrowDown",
  });
  expect(
    await screen.findByRole("menuitemradio", { name: "Dark" }),
  ).toBeDefined();
  expect(screen.queryByText("Chat position")).toBeNull();
});

test("the rule both names are held to stands under each field before anything is typed", async () => {
  served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  expect(projectNameRule).toBe("Lowercase letters, digits, inner hyphens");
  for (const label of ["Workspace", "Project"]) {
    expect(ruleUnder(label).textContent, label).toBe(projectNameRule);
    expect(ruleUnder(label).className, label).not.toContain("text-tone-fail");
  }
  expect(screen.queryByText("Tenant")).toBeNull();
});

test("a name the wire refuses turns its own rule line, and nothing is sent", async () => {
  const posted = served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  typed("Workspace", "Vteng");
  typed("Project", "chuggy");
  expect(ruleUnder("Workspace").textContent).toBe(projectNameRule);
  expect(ruleUnder("Workspace").className).toContain("text-tone-fail");
  expect(ruleUnder("Project").className).not.toContain("text-tone-fail");
  expect(
    screen
      .getByRole("textbox", { name: "Workspace" })
      .getAttribute("aria-invalid"),
  ).toBe("true");
  expect(submit()).toHaveProperty("disabled", true);
  fireEvent.click(submit());
  await settled();
  expect(posted).toEqual([]);
});

test("a created project is opened at its repositories and remembered", async () => {
  const posted = served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(posted.map((one) => one.body)).toEqual([partition]);
  expect(posted[0]?.key).toBeTruthy();
  expect(held.went).toEqual([
    { to: "/$tenant/$project/repositories", params: partition },
  ]);
  expect(lastProjectRead(persistentStore)).toEqual(partition);
});

test("a refusal is one short line, and the form stays where it was", async () => {
  served([], () =>
    Promise.resolve(
      answer({ error: { code: "TenantTaken", message: "taken" } }, 409),
    ),
  );
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(answerLine()?.textContent).toBe("Taken");
  expect(held.went).toEqual([]);
});

test("a workspace the reader may not make says what a new one needs, and the form stays where it was", async () => {
  served([], () =>
    Promise.resolve(
      answer(
        { error: { code: "TenantCreationNotPermitted", message: "no" } },
        403,
      ),
    ),
  );
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(answerLine()?.textContent).toBe("New workspace needs an invite link");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Workspace" }).value,
  ).toBe(partition.tenant);
  expect(held.went).toEqual([]);
});

test("a press repeated after no answer spends the same identity, and an edit draws a new one", async () => {
  const posted = served([], () => Promise.reject(new Error("offline")));
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(answerLine()?.textContent).toBe("Unreachable");
  await pressed();
  typed("Project", "arbbot");
  await pressed();
  const keys = posted.map((one) => one.key);
  expect(keys).toHaveLength(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test("the switcher offers a new project beside every project, and it opens the form in the workspace of the project shown", async () => {
  served([partition], () => Promise.resolve(answer(partition, 201)));
  await drawn(<ProjectSwitcher partition={partition} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  const item = await screen.findByRole("menuitem", {
    name: projectSwitcherCreateText,
  });
  expect(
    screen.getAllByRole("menuitemradio").map((one) => one.textContent),
  ).toEqual(["vteng / chuggy"]);
  fireEvent.click(item);
  expect(held.went).toStrictEqual([
    { to: projectCreationRoutePath, search: { workspace: partition.tenant } },
  ]);
});
