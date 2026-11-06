/**
 * One epic: its figures, its graph and history, and the edit form, which is
 * drawn only for a reader who may write and sent at the revision read.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicPage } from "../app/browser/EpicPage.tsx";
import { leadPartition } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesFetch,
  abilitiesNone,
} from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import {
  answer,
  openedStream,
  scriptedFetch,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
  useParams: () => ({ ...leadPartition, epic: "7" }),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = {
  number: 7,
  revision: 3,
  title: "Billing",
  summary: "All of billing",
  description: "The **whole** of billing",
  visibility: "Active",
  progress: {
    byPhase: {
      Pending: 1,
      Work: 0,
      Evaluation: 0,
      Finalization: 0,
      Done: 1,
      Escalated: 0,
      Revoked: 0,
    },
    done: 1,
    total: 2,
  },
  status: "in_progress",
  waitingOnOutside: [2],
  tickets: [4, 5],
};

const graph = {
  nodes: [
    { ticket: 2, title: "Schema", phase: "Work", member: false },
    { ticket: 4, title: "Charge", phase: "Done", member: true },
    { ticket: 5, title: "Refund", phase: "Pending", member: true },
  ],
  edges: [
    { from: 2, to: 5 },
    { from: 4, to: 5 },
  ],
};

const history = {
  revisions: [
    {
      revision: 3,
      changedAt: "2026-10-01T00:00:00Z",
      actor: { kind: "user", subject: "dana" },
      title: "Billing",
    },
  ],
};

function served(
  written: (request: SentRequest) => Response,
): (request: SentRequest) => Response {
  return (request) => {
    if (request.method !== "GET") return written(request);
    if (request.url.endsWith("/graph")) return answer(graph);
    if (request.url.includes("/history")) return answer(history);
    return answer(view);
  };
}

async function drawn(
  abilities: AbilitiesAnswer,
  written: (request: SentRequest) => Response = () => answer({}, 503),
): Promise<readonly SentRequest[]> {
  const scripted = scriptedFetch(served(written));
  vi.stubGlobal("fetch", abilitiesFetch(abilities, scripted.fetch));
  render(
    <ScreenHarness
      partition={leadPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <EpicPage />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

test("the epic is drawn with its figures, its graph and its history", async () => {
  await drawn(abilitiesNone);
  expect(screen.getByText("In progress")).toBeTruthy();
  expect(screen.getByText("1 of 2 done")).toBeTruthy();
  expect(screen.getByText("whole")).toBeTruthy();
  const graphic = screen.getByRole("group", {
    name: "Tickets of the epic and what they wait on",
  });
  expect(graphic.querySelectorAll("path.epic-graph-edge")).toHaveLength(2);
  expect(graphic.querySelector("g[data-external]")?.textContent).toBe(
    "#2 Schema",
  );
  expect(graphic.querySelectorAll("g[data-member]")).toHaveLength(2);
  expect(screen.getByText("Revision 3")).toBeTruthy();
});

test("the edit form is drawn for a reader who may write and not for one who may not", async () => {
  await drawn(abilitiesNone);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  cleanup();
  await drawn(abilitiesEvery);
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
});

async function editedTitle(title: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await settled();
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settled();
}

test("a revision is sent at the revision that was read", async () => {
  const sent = await drawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  await editedTitle("Payments");
  const writes = sent.filter((request) => request.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { title: "Payments", tickets: [4, 5] },
  });
});

test("a revision made over another's is refused as stale and offers a reload", async () => {
  await drawn(abilitiesEvery, () =>
    answer(
      { error: { code: "StaleRevision", message: "stale" }, current: 5 },
      409,
    ),
  );
  await editedTitle("Payments");
  expect(screen.getByRole("alert").textContent).toContain("Reload");
  expect(screen.getByRole("button", { name: "Reload the epic" })).toBeTruthy();
});
