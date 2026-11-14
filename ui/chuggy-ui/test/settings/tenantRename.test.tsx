/**
 * A workspace's display name, changed on its People page: drawn only to a
 * reader who administers the workspace, starting on the name the reader's own
 * list answers, sending the trimmed name to the workspace's own address and
 * nothing else, reading the list again so the new name is drawn, and saying a
 * refusal in place.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { accessNotPermittedCode } from "../../../../src/contract/accessPlane.ts";
import { displayNameCharsMax } from "../../../../src/contract/requests.ts";
import { answer, press, settled, turned } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  changesSent,
  drawPeople,
  noContent,
  peopleAbilitiesAll,
  peopleAbilitiesNone,
  peopleTenant,
  peopleWorkspaceName,
  peopleWorkspacesPath,
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

const renamePath = `/access/v1/tenants/${peopleTenant}/display-name`;

function nameBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: "Workspace name",
  });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Save name" });
}

async function typedName(name: string): Promise<void> {
  await turned(() => {
    fireEvent.change(nameBox(), { target: { value: name } });
  });
}

/** The reader's own workspaces, this one under `displayName`. */
function workspacesNamed(displayName: string): () => Response {
  return () =>
    answer({
      tenants: [
        {
          tenant: peopleTenant,
          displayName,
          roles: ["Admin"],
          administer: true,
        },
      ],
      truncated: false,
    });
}

test("an administrator is offered the workspace's name, starting on its display name with its address beside it, and nothing to save until it changes", async () => {
  await drawPeople();
  expect(screen.getByRole("heading", { name: "Name" })).toBeTruthy();
  expect(nameBox().value).toBe(peopleWorkspaceName);
  expect(
    screen.getByText(
      `What this workspace is called wherever it is shown. Its address stays ${peopleTenant}.`,
      { exact: false },
    ),
  ).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
});

test("a reader who does not administer the workspace is offered no name to change", async () => {
  await drawPeople({ abilities: () => answer(peopleAbilitiesNone) });
  expect(screen.queryByRole("heading", { name: "Name" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Workspace name" })).toBeNull();
  await drawPeople({
    abilities: () =>
      answer({ ...peopleAbilitiesAll(), administerTenant: false }),
  });
  expect(screen.queryByRole("textbox", { name: "Workspace name" })).toBeNull();
});

test("a name typed is sent trimmed to the workspace's own address, its list is read again, and the box then holds the name the list answers", async () => {
  let name = peopleWorkspaceName;
  const drawn = await drawPeople({
    workspaces: () => workspacesNamed(name)(),
    changed: (request) => {
      if (request.url === renamePath && request.method === "POST")
        name = (request.body as { displayName: string }).displayName;
      return noContent();
    },
  });
  const reads = () =>
    drawn.sent.filter((request) => request.url === peopleWorkspacesPath).length;
  const before = reads();
  await typedName("  Acme Works  ");
  expect(saveButton().disabled).toBe(false);
  await press("Save name");
  await settled();
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: renamePath,
      body: { displayName: "Acme Works" },
    },
  ]);
  expect(reads()).toBeGreaterThan(before);
  expect(nameBox().value).toBe("Acme Works");
  expect(screen.getByText("The name is saved.")).toBeTruthy();
});

test("a name the contract refuses is marked and cannot be saved, and sends nothing", async () => {
  const drawn = await drawPeople();
  for (const typed of [
    "   ",
    "n".repeat(displayNameCharsMax + 1),
    "two\u0007bells",
  ]) {
    await typedName(typed);
    expect(nameBox().getAttribute("aria-invalid")).toBe("true");
    expect(saveButton().disabled).toBe(true);
  }
  expect(changesSent(drawn)).toStrictEqual([]);
});

test("a refused rename says so in place and keeps what was typed", async () => {
  await drawPeople({ changed: () => refused(403, accessNotPermittedCode) });
  await typedName("Acme Works");
  await press("Save name");
  expect(nameBox().value).toBe("Acme Works");
  expect(screen.queryByText("The name is saved.")).toBeNull();
  expect(document.querySelector(".notice-danger")).not.toBeNull();
});
