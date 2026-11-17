/**
 * The page a project is made at, and the switcher entry that reaches it, or
 * the welcome page for a reader with no project, mounted over a plane that
 * answers neither of the form's reads, so its workspace is the free text a
 * failed read leaves.
 *
 * What is asserted is the traffic as well as the words: a name the wire would
 * refuse sends nothing, and a press repeated after an answer that never arrived
 * goes under the identity the first one spent.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";

import { ProjectCreationPage } from "../app/browser/ProjectCreation.tsx";
import { ProjectSwitcher } from "../app/browser/shell/ProjectSwitcher.tsx";
import { copyTextEn } from "../app/copy/catalog.ts";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { lastProjectRead } from "../app/core/lastProject.ts";
import { memberChatRoutes } from "../app/core/memberChat.ts";
import { projectDisplayNameCharsMax } from "../../../src/contract/requests.ts";
import {
  projectCreationRoutePath,
  projectDisplayNameRule,
  projectNameLengthFault,
  projectNameRule,
} from "../app/core/projectCreation.ts";
import { persistentStore } from "../app/browser/ports.ts";
import {
  accessHolding,
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
import { textSaid } from "./textSaid.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
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
/** The project as the api answers it, called what its form typed. */
const named = { ...partition, name: "Chuggy" };

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
  held.went.length = 0;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the page draws the form, under a bar that signs out", async () => {
  served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  expect(screen.getByRole("heading", { name: "New project" })).toBeDefined();
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

test("the rule each name is held to stands under its field before anything is typed, the project's with where it is shown", async () => {
  served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  expect(copyTextEn(projectNameRule)).toBe(
    "Lowercase letters, digits, inner hyphens",
  );
  expect(ruleUnder("Workspace").textContent).toBe(copyTextEn(projectNameRule));
  expect(ruleUnder("Project").textContent).toBe(
    copyTextEn(projectDisplayNameRule),
  );
  expect(copyTextEn(projectDisplayNameRule)).toBe(
    "Any name, shown in the project menu; its address is made from it",
  );
  for (const label of ["Workspace", "Project"])
    expect(faulted(label), label).toBe(false);
  expect(more().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  expect(screen.queryByText("Tenant")).toBeNull();
});

/** The form's one disclosure, which holds what a project is made without. */
function more(): HTMLElement {
  return screen.getByRole("button", { name: "More options" });
}

async function moreToggled(): Promise<void> {
  await turned(() => {
    fireEvent.click(more());
  });
}

test("a project is named as the reader calls it, and sent at the address that name makes, shown under it as it is typed", async () => {
  const posted = served([], () =>
    Promise.resolve(
      answer(
        { ...partition, project: "acme-billing", name: "Acme Billing" },
        201,
      ),
    ),
  );
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", "Acme");
  expect(ruleUnder("Project").textContent).toBe("Address: acme");
  typed("Project", "Acme Billing");
  expect(ruleUnder("Project").textContent).toBe("Address: acme-billing");
  expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  await pressed();
  expect(posted.map((one) => one.body)).toEqual([
    { tenant: "vteng", project: "acme-billing", name: "Acme Billing" },
  ]);
});

test("an address the reader edits stops following the name", async () => {
  const posted = served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", "Acme Billing");
  await moreToggled();
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Address" }).value,
  ).toBe("acme-billing");
  typed("Address", "billing");
  typed("Project", "Acme Billing, the second");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Address" }).value,
  ).toBe("billing");
  expect(ruleUnder("Project").textContent).toBe("Address: billing");
  await moreToggled();
  expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  expect(ruleUnder("Project").textContent).toBe("Address: billing");
  await pressed();
  expect(posted.map((one) => one.body)).toEqual([
    { tenant: "vteng", project: "billing", name: "Acme Billing, the second" },
  ]);
});

test("a name that makes no address opens the disclosure on the box that asks for one, and nothing is sent until it is typed", async () => {
  const posted = served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", "!!!");
  expect(ruleUnder("Project").textContent).toBe(
    copyTextEn({ id: "project-creation-address-none" }),
  );
  expect(more().getAttribute("aria-expanded")).toBe("true");
  expect(ruleUnder("Address").textContent).toBe(
    copyTextEn({ id: "project-creation-address-hint" }),
  );
  expect(submit()).toHaveProperty("disabled", true);
  typed("Address", "bang");
  await pressed();
  expect(posted.map((one) => one.body)).toEqual([
    { tenant: "vteng", project: "bang", name: "!!!" },
  ]);
});

test("a name the wire would refuse turns the line under it, and nothing is sent", async () => {
  const posted = served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", "n".repeat(projectDisplayNameCharsMax + 1));
  expect(ruleUnder("Project").textContent).toBe(
    copyTextEn(projectNameLengthFault),
  );
  expect(faulted("Project")).toBe(true);
  expect(submit()).toHaveProperty("disabled", true);
  typed("Project", "   ");
  expect(submit()).toHaveProperty("disabled", true);
  fireEvent.click(submit());
  await settled();
  expect(posted).toEqual([]);
});

test("a name the wire refuses turns its own rule line, and nothing is sent", async () => {
  const posted = served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
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
  const posted = served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
  await pressed();
  expect(posted.map((one) => one.body)).toEqual([named]);
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
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
  await pressed();
  cleanup();
  await turned(() => {
    creating.release(answer(named, 201));
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
  const shown = await redrawable(<ProjectCreationPage />, consoleQueryClient());
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
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
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
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
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
  await pressed();
  expect(errorUnder("Workspace")).toBe("New workspace needs an invite link");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Workspace" }).value,
  ).toBe(partition.tenant);
  expect(held.went).toEqual([]);
});

test("a press repeated after no answer spends the same identity, and an edit draws a new one", async () => {
  const posted = served([], () => Promise.reject(new Error("offline")));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
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
  served([named], () => Promise.resolve(answer(named, 201)));
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
  return screen.getAllByRole("menuitemradio").map(textSaid);
}

test("the switcher offers the workspace shown with no project where it lets the reader chat outside one, and that opens their own chat", async () => {
  chatServed(true);
  await drawn(<ProjectSwitcher partition={partition} />);
  expect(await switcherOffers()).toEqual([
    "vteng / No project",
    "vteng / Chuggy",
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
  expect(await switcherOffers()).toEqual(["vteng / Chuggy"]);
});

test("the switcher offers a new project beside every project, and it opens the form in the workspace of the project shown", async () => {
  served([named], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectSwitcher partition={partition} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  const item = await screen.findByRole("menuitem", {
    name: copyTextEn({ id: "shell-project-new" }),
  });
  expect(screen.getAllByRole("menuitemradio").map(textSaid)).toEqual([
    "vteng / Chuggy",
  ]);
  fireEvent.click(item);
  expect(held.went).toStrictEqual([
    { to: projectCreationRoutePath, search: { workspace: partition.tenant } },
  ]);
});

test("an empty switcher offers the welcome page and not the form", async () => {
  served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectSwitcher partition={undefined} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project/ }), {
    key: "ArrowDown",
  });
  const item = await screen.findByRole("menuitem", {
    name: copyTextEn({ id: "shell-project-welcome" }),
  });
  expect(
    screen.queryByRole("menuitem", {
      name: copyTextEn({ id: "shell-project-new" }),
    }),
  ).toBeNull();
  fireEvent.click(item);
  expect(held.went).toStrictEqual([{ to: "/" }]);
});

test("the switcher names each workspace by the display name the reader's own list answers, and one it does not by its id, while a pick still goes to the id's address", async () => {
  const elsewhere = { tenant: "globex", project: "web", name: "Web" };
  served(
    [named, elsewhere],
    () => Promise.resolve(answer(partition, 201)),
    accessHolding([
      {
        tenant: partition.tenant,
        displayName: "Vantage Engineering",
        roles: ["Admin"],
        administer: true,
      },
    ]),
  );
  await drawn(<ProjectSwitcher partition={partition} />);
  expect(await switcherOffers()).toEqual([
    "Vantage Engineering / Chuggy",
    "globex / Web",
  ]);
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: "Vantage Engineering / Chuggy" }),
  );
  expect(held.went).toStrictEqual([
    { to: "/$tenant/$project", params: partition },
  ]);
});

test("each name is a field whose visible label is bound to its box, marked required, and described by its hint", async () => {
  served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
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
  ["ProjectExists", 409, "Address", "Exists"],
  ["ProjectNameInvalid", 422, "Address", copyTextEn(projectNameRule)],
  [
    "ProjectDisplayNameInvalid",
    422,
    "Project",
    copyTextEn({ id: "project-creation-display-name-control" }),
  ],
] as const)(
  "a %s refusal, answered %i, is drawn under %s alone, and the focus moves to its box",
  async (code, status, label, line) => {
    served([], () =>
      Promise.resolve(answer({ error: { code, message: code } }, status)),
    );
    await drawn(<ProjectCreationPage />);
    typed("Workspace", partition.tenant);
    typed("Project", named.name);
    await pressed();
    const box = screen.getByRole("textbox", { name: label });
    expect(document.activeElement).toBe(box);
    expect(errorUnder(label)).toBe(line);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    for (const other of ["Workspace", "Project", "Address"])
      if (other !== label && screen.queryByRole("textbox", { name: other }))
        expect(errorUnder(other), other).toBeNull();
    expect(answerLine()).toBeNull();
  },
);

test("the first screen asks for the workspace and the name alone, under one primary action, and its one disclosure holds the address", async () => {
  served([], () => Promise.resolve(answer(named, 201)));
  await drawn(<ProjectCreationPage />);
  expect(
    screen
      .getAllByRole("textbox")
      .map((box) => box.getAttribute("aria-label") ?? box.id),
  ).toHaveLength(2);
  expect(document.querySelectorAll(".btn-primary")).toHaveLength(1);
  expect(document.querySelector(".btn-primary")).toBe(submit());
  expect(screen.getAllByRole("button", { expanded: false })).toContain(more());
  await moreToggled();
  expect(screen.getAllByRole("textbox")).toHaveLength(3);
  expect(
    screen
      .getByRole("textbox", { name: "Address" })
      .getAttribute("aria-required"),
  ).toBeNull();
});

test("a refusal about the address opens the disclosure a reader closed, once for that refusal", async () => {
  served([], () =>
    Promise.resolve(
      answer({ error: { code: "ProjectExists", message: "exists" } }, 409),
    ),
  );
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
  await pressed();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Address" }),
  );
  await moreToggled();
  expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  expect(more().getAttribute("aria-expanded")).toBe("false");
});

test("a refusal about neither name is the line beside the submit, and moves the focus to no field", async () => {
  served([], () => Promise.reject(new Error("offline")));
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
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
  await drawn(<ProjectCreationPage />);
  typed("Workspace", partition.tenant);
  typed("Project", named.name);
  await pressed();
  expect(answerLine()?.textContent).toBe("Creating project…");
  expect(submit()).toHaveProperty("disabled", true);
  expect(submit().getAttribute("aria-busy")).toBe("true");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([named]);
  await turned(() => {
    creating.release(answer(named, 201));
  });
  await settled();
  expect(posted).toHaveLength(1);
  expect(held.went).toEqual([
    { to: "/$tenant/$project/settings/repositories", params: partition },
  ]);
});
