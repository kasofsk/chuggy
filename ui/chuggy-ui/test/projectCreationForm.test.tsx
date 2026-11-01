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
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { lastProjectRead } from "../app/core/lastProject.ts";
import { memberChatRoutes } from "../app/core/memberChat.ts";
import {
  projectCreationRoutePath,
  projectNameRule,
} from "../app/core/projectCreation.ts";
import { persistentStore } from "../app/browser/ports.ts";
import {
  answerLine,
  drawn,
  pressed,
  redrawable,
  ruleUnder,
  served,
  submit,
  typed,
} from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, heldAnswer, settled, turned } from "./screenHarness.tsx";
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
  expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
    key: "ArrowDown",
  });
  expect(
    await screen.findByRole("menuitemradio", { name: "Dark" }),
  ).toBeDefined();
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeDefined();
  expect(screen.queryByText("Chat position")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Runners" })).toBeNull();
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

/** The creation outlives the form, so the project it made is opened whether or
 * not the form is still drawn when it answers. */
test("a project created after its form was left is still opened at its repositories", async () => {
  const creating = heldAnswer();
  served([], () => creating.answered);
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  cleanup();
  await turned(() => {
    creating.release(answer(partition, 201));
  });
  await settled();
  expect(held.went).toEqual([
    { to: "/$tenant/$project/repositories", params: partition },
  ]);
  expect(lastProjectRead(persistentStore)).toEqual(partition);
});

/** A form drawn again holds none of the names the creation was sent with, so
 * the refusal is drawn nowhere on it and is the shell's toast instead. */
test("a creation refused after its form was drawn again empty is a toast and no line", async () => {
  const creating = heldAnswer();
  served([], () => creating.answered);
  const shown = await redrawable(<Landing />, consoleQueryClient());
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  await shown(false);
  await shown(true);
  expect(submit()).toHaveProperty("disabled", true);

  await turned(() => {
    creating.release(
      answer({ error: { code: "TenantTaken", message: "taken" } }, 409),
    );
  });
  await settled();

  expect(answerLine()).toBeNull();
  expect(
    [...document.querySelectorAll(".toast-line")].map(
      (line) => line.textContent,
    ),
  ).toStrictEqual(["Taken"]);
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

/** The projects as `served` answers them, and the workspace's chat abilities
 * answering whether the reader may chat outside a project. */
function chatServed(opens: boolean): void {
  served([partition], () => Promise.resolve(answer(partition, 201)));
  const projects = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith(`/tenants/${partition.tenant}/chat/abilities`)
      ? Promise.resolve(
          answer({
            principal: "geoff",
            openUnscopedChat: opens,
            executeHosted: false,
            registerPersonalRunner: false,
            administerTenant: false,
          }),
        )
      : projects(url, init),
  );
}

async function switcherOffers(): Promise<readonly (string | null)[]> {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  return screen.getAllByRole("menuitemradio").map((one) => one.textContent);
}

test("the switcher offers the workspace shown with no project where it lets the reader chat outside one, and that opens their own chat", async () => {
  chatServed(true);
  await drawn(<ProjectSwitcher partition={partition} />);
  expect(await switcherOffers()).toEqual([
    "vteng / No project",
    "vteng / chuggy",
  ]);
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: "vteng / No project" }),
  );
  expect(held.went).toStrictEqual([
    { to: memberChatRoutes.chat, params: { tenant: partition.tenant } },
  ]);
});

test("the switcher offers no project only where the workspace lets the reader chat outside one", async () => {
  chatServed(false);
  await drawn(<ProjectSwitcher partition={partition} />);
  expect(await switcherOffers()).toEqual(["vteng / chuggy"]);
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
