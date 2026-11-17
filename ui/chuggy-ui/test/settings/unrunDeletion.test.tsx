/**
 * The Delete sections, mounted: drawn only where the deletion would be done,
 * asked in a dialog with the thing deleted named, a deletion landed as a line
 * with a way back to the start, and one refused naming what holds it.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  ProjectDeletion,
  TenantDeletion,
} from "../../app/browser/settings/UnrunDeletion.tsx";
import {
  answer,
  drawnStrict,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A deletion route answering `standing` to its read and `deleted` to a DELETE. */
function deletionRoute(
  standing: () => Response,
  deleted: () => Response = () => new Response(null, { status: 204 }),
): (request: SentRequest) => Response {
  return (request) => {
    if (!request.url.endsWith("/deletion")) return answer({}, 404);
    return request.method === "DELETE" ? deleted() : standing();
  };
}

function deletesSent(drawn: DrawnStrict): readonly string[] {
  return drawn.sent
    .filter((request) => request.method === "DELETE")
    .map((request) => request.url);
}

/** The button of the dialog asking, which shares its word with the one that
 * opened it. */
async function pressAsked(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name }),
    );
  });
  await settled();
}

test("a deletion is asked in a dialog, and Cancel there sends nothing", async () => {
  const drawn = await drawnStrict(
    <TenantDeletion tenant={leadPartition.tenant} />,
    deletionRoute(() => answer({ held: [] })),
  );
  await press("Delete workspace");
  await pressAsked("Cancel");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(deletesSent(drawn)).toEqual([]);
});

test("a project nothing holds is deleted once asked, naming it by its name, and offers the way back", async () => {
  let listed = true;
  const deletions = deletionRoute(
    () => answer({ held: [] }),
    () => {
      listed = false;
      return new Response(null, { status: 204 });
    },
  );
  const drawn = await drawnStrict(
    <ProjectDeletion partition={leadPartition} />,
    (request) =>
      request.url.endsWith("/api/v1/projects")
        ? answer({
            projects: listed
              ? [{ ...leadPartition, name: "Atlas Billing" }]
              : [],
          })
        : deletions(request),
  );
  await press("Delete project");
  const asked = screen.getByRole("dialog", {
    name: "Delete Atlas Billing?",
  });
  expect(asked.textContent).toContain("cannot be undone");
  expect(deletesSent(drawn)).toEqual([]);
  await pressAsked("Delete project");
  expect(deletesSent(drawn)).toHaveLength(1);
  expect(deletesSent(drawn)[0]).toContain(
    `/projects/${leadPartition.project}/deletion`,
  );
  expect(
    screen.getByText("Atlas Billing is deleted.", { exact: false }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Back to the start" })
      .getAttribute("href"),
  ).toBe("/");
});

test("a project that has run work, or a reader who may not delete it, is offered nothing", async () => {
  await drawnStrict(
    <ProjectDeletion partition={leadPartition} />,
    deletionRoute(() => answer({ held: ["ReleasedTicket"] })),
  );
  expect(screen.queryByRole("button", { name: "Delete project" })).toBeNull();
  cleanup();
  await drawnStrict(
    <ProjectDeletion partition={leadPartition} />,
    deletionRoute(() => answer({}, 404)),
  );
  expect(screen.queryByRole("button", { name: "Delete project" })).toBeNull();
});

test("a deletion refused because a ticket was released since names what holds it", async () => {
  await drawnStrict(
    <ProjectDeletion partition={leadPartition} />,
    deletionRoute(
      () => answer({ held: [] }),
      () =>
        answer(
          {
            error: { code: "DeletionHeld", message: "held" },
            held: ["ReleasedTicket", "Execution"],
          },
          409,
        ),
    ),
  );
  await press("Delete project");
  await pressAsked("Delete project");
  const refused = screen.getByText(/It cannot be deleted/u);
  expect(refused.textContent).toMatch(/released.*runs/u);
  expect(screen.queryByText(/is deleted/u)).toBeNull();
});

test("a workspace holding no project is deleted once asked, naming it", async () => {
  const tenant = leadPartition.tenant;
  const drawn = await drawnStrict(
    <TenantDeletion tenant={tenant} />,
    deletionRoute(() => answer({ held: [] })),
  );
  await press("Delete workspace");
  expect(
    screen.getByRole("dialog", { name: `Delete ${tenant}?` }),
  ).toBeTruthy();
  await pressAsked("Delete workspace");
  expect(deletesSent(drawn)).toEqual([
    expect.stringContaining(`/tenants/${tenant}/deletion`),
  ]);
  expect(
    screen.getByText(`${tenant} is deleted.`, { exact: false }),
  ).toBeTruthy();
});

test("a workspace still holding a project is offered nothing", async () => {
  await drawnStrict(
    <TenantDeletion tenant={leadPartition.tenant} />,
    deletionRoute(() => answer({ held: ["Project"] })),
  );
  expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
});
