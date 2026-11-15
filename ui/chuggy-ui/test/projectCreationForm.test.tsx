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
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";

import { Landing } from "../app/browser/routes.tsx";
import { ProjectSwitcher } from "../app/browser/shell/ProjectSwitcher.tsx";
import { copyTextEn } from "../app/copy/catalog.ts";
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
  errorUnder,
  faulted,
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
  /** A menu item draws its link through `asChild`, so the double keeps the
   * role, focus and handlers the item hands it, and only the route is
   * dropped. */
  Link: (
    props: ComponentProps<"a"> & {
      readonly to?: unknown;
      readonly params?: unknown;
    },
  ) => (
    <a
      {...Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => !["to", "params"].includes(key),
        ),
      )}
      href="/"
    />
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

test("a reader with no project meets the form, under a bar that signs out", async () => {
  served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  expect(screen.getByText("No projects")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Workspace" })).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Project" })).toBeDefined();
  expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toStrictEqual(["Sign out"]);
});

test("the rule both names are held to stands under each field before anything is typed, the project's with where it is shown", async () => {
  served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  expect(copyTextEn(projectNameRule)).toBe(
    "Lowercase letters, digits, inner hyphens",
  );
  expect(ruleUnder("Workspace").textContent).toBe(copyTextEn(projectNameRule));
  expect(ruleUnder("Project").textContent).toBe(
    `${copyTextEn(projectNameRule)}. Shown in its address and the project menu`,
  );
  for (const label of ["Workspace", "Project"])
    expect(faulted(label), label).toBe(false);
  expect(screen.queryByText("Tenant")).toBeNull();
});

test("a name the wire refuses turns its own rule line, and nothing is sent", async () => {
  const posted = served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  typed("Workspace", "Vteng");
  typed("Project", "chuggy");
  expect(ruleUnder("Workspace").textContent).toBe(copyTextEn(projectNameRule));
  expect(faulted("Workspace")).toBe(true);
  expect(faulted("Project")).toBe(false);
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
    { to: "/$tenant/$project/settings/repositories", params: partition },
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
    { to: "/$tenant/$project/settings/repositories", params: partition },
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

test("a refusal is one short line under the name it is about, and the form stays where it was", async () => {
  served([], () =>
    Promise.resolve(
      answer({ error: { code: "TenantTaken", message: "taken" } }, 409),
    ),
  );
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(errorUnder("Workspace")).toBe("Taken");
  expect(answerLine()).toBeNull();
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
  expect(errorUnder("Workspace")).toBe("New workspace needs an invite link");
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
    name: copyTextEn({ id: "shell-project-new" }),
  });
  expect(
    screen.getAllByRole("menuitemradio").map((one) => one.textContent),
  ).toEqual(["vteng / chuggy"]);
  fireEvent.click(item);
  expect(held.went).toStrictEqual([
    { to: projectCreationRoutePath, search: { workspace: partition.tenant } },
  ]);
});

test("each name is a field whose visible label is bound to its box, marked required, and described by its hint", async () => {
  served([], () => Promise.resolve(answer(partition, 201)));
  await drawn(<Landing />);
  for (const label of ["Workspace", "Project"]) {
    const box = screen.getByRole("textbox", { name: label });
    const caption = document.querySelector(`label[for="${box.id}"]`);
    expect(caption?.firstChild?.textContent, label).toBe(label);
    expect(box.getAttribute("aria-required"), label).toBe("true");
    expect(ruleUnder(label).className, label).toBe("form-field-hint");
  }
});

test.each([
  ["TenantTaken", 409, "Workspace", "Taken"],
  ["ProjectExists", 409, "Project", "Exists"],
  ["ProjectNameInvalid", 422, "Project", copyTextEn(projectNameRule)],
] as const)(
  "a %s refusal, answered %i, is drawn under %s alone, and the focus moves to its box",
  async (code, status, label, line) => {
    served([], () =>
      Promise.resolve(answer({ error: { code, message: code } }, status)),
    );
    await drawn(<Landing />);
    typed("Workspace", partition.tenant);
    typed("Project", partition.project);
    await pressed();
    const box = screen.getByRole("textbox", { name: label });
    expect(document.activeElement).toBe(box);
    expect(errorUnder(label)).toBe(line);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const other = label === "Workspace" ? "Project" : "Workspace";
    expect(errorUnder(other)).toBeNull();
    expect(answerLine()).toBeNull();
  },
);

test("a refusal about neither name is the line beside the submit, and moves the focus to no field", async () => {
  served([], () => Promise.reject(new Error("offline")));
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  submit().focus();
  await pressed();
  expect(answerLine()?.textContent).toBe("Unreachable");
  expect(document.activeElement).toBe(submit());
  expect(errorUnder("Workspace")).toBeNull();
  expect(errorUnder("Project")).toBeNull();
});

test("while the project is being made the page says so and a second press sends nothing", async () => {
  const creating = heldAnswer();
  const posted = served([], () => creating.answered);
  await drawn(<Landing />);
  typed("Workspace", partition.tenant);
  typed("Project", partition.project);
  await pressed();
  expect(answerLine()?.textContent).toBe("Creating project…");
  expect(submit()).toHaveProperty("disabled", true);
  expect(submit().getAttribute("aria-busy")).toBe("true");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([partition]);
  await turned(() => {
    creating.release(answer(partition, 201));
  });
  await settled();
  expect(posted).toHaveLength(1);
  expect(held.went).toEqual([
    { to: "/$tenant/$project/settings/repositories", params: partition },
  ]);
});
