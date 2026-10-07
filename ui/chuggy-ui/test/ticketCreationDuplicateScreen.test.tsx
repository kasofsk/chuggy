/**
 * The new-ticket screen started from another ticket, over the project's own
 * reads: the original's draft and its dependencies read as it opens, the form
 * seeded from them, the line naming what was not carried, the title naming
 * where it started, and a fresh form for each ticket it starts from.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import { TicketCreationFrom } from "../app/browser/TicketDuplicate.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  press,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationListed,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const waiting = vi.hoisted(() => ({ held: true }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.held ? new Promise<void>(() => undefined) : Promise.resolve(),
}));

const left = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly children?: ReactNode;
    readonly params?: { readonly ticket?: string };
  }) => <a href={`/tickets/${props.params?.ticket ?? ""}`}>{props.children}</a>,
  useBlocker: () => undefined,
  useNavigate: () => (target: { readonly to: string }) => {
    left.to.push(target.to);
    return Promise.resolve();
  },
  useParams: () => ({ ...creationPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
  left.to = [];
  waiting.held = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chuggy = "https://forge.test/kasofsk/chuggy";
const other = "https://forge.test/kasofsk/other";

const listing = {
  configurations: [
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    creationDeclared("n-development", chuggy, "development"),
  ],
};

const brief = {
  title: "Ship it",
  intent: "ship the thing",
  links: ["https://example.test/one"],
  checks: ["npm test"],
  repository: chuggy,
  branch: "refs/heads/topic/one",
  finalization: { mode: "PullRequest" as const, target: "refs/heads/main" },
};

/** Ticket 11, revoked, authored under development and depending on a revoked
 * ticket and on one the form's candidates do not list. */
const eleven: DraftResponse = {
  ...creationDraft,
  ticket: 11,
  state: "Released",
  releasedAuthoringVersion: 3,
  configurationRevision: "o-development",
  configurationVersion: { name: "development", number: 2 },
  authoring: {
    dependencies: [7, 40],
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  },
  brief,
};

const thirteen: DraftResponse = {
  ...eleven,
  ticket: 13,
  authoring: { ...eleven.authoring, dependencies: [] },
  brief: { ...brief, title: "Another one", intent: "another thing" },
};

function ticketOf(ticket: number, phase: string): unknown {
  return { ticket, phase, sequence: 41, ...ticketInstants };
}

interface Project {
  readonly drafts: readonly DraftResponse[];
  readonly bindings?: readonly ReturnType<typeof creationListed>[];
  readonly configurations?: typeof listing.configurations;
}

/** One project's API, which creates ticket 50 and settles its release. */
function routed(project: Project): (request: SentRequest) => Response {
  return ({ method, url }) => {
    if (method === "POST" && url.endsWith("/drafts"))
      return answer({ ...creationDraft, ticket: 50 }, 201);
    if (method === "POST")
      return answer({ operation: "op", state: "Pending" }, 202);
    if (url.includes("/operations/"))
      return answer({
        operation: "op",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Succeeded",
        decidedSequence: 43,
      });
    if (url.endsWith("/repositories"))
      return answer({
        repositories: project.bindings ?? [
          creationListed(creationBinding(chuggy), "Imported"),
        ],
      });
    if (url.includes("/configurations"))
      return answer({
        configurations: project.configurations ?? listing.configurations,
      });
    if (url.includes("/draft-initializations/")) {
      const revision = url.slice(url.lastIndexOf("/") + 1);
      return answer({
        ...creationInitialization,
        commandedCheckStage: 1,
        configuration: { ...creationInitialization.configuration, revision },
      });
    }
    const draft = project.drafts.find((held) =>
      url.endsWith(`/drafts/${String(held.ticket)}`),
    );
    if (draft !== undefined) return answer(draft);
    if (url.endsWith("/tickets/7")) return answer(ticketOf(7, "Revoked"));
    if (url.endsWith("/tickets/40")) return answer(ticketOf(40, "Pending"));
    return answer({
      partition: creationPartition,
      sequence: 43,
      tickets: [ticketOf(50, "Pending")],
    });
  };
}

function drawn(from: number | undefined): ReactNode {
  return <TicketCreationFrom from={from} />;
}

async function drawDuplicate(
  from: number | undefined,
  project: Project = { drafts: [eleven, thirteen] },
): Promise<{
  readonly sent: readonly SentRequest[];
  readonly redraw: (next: number | undefined) => Promise<void>;
}> {
  const scripted = scriptedFetch(routed(project));
  vi.stubGlobal("fetch", scripted.fetch);
  const client = new QueryClient();
  const transport = openedStream().ports.fetch;
  const harnessed = (inner: ReactNode): ReactNode => (
    <ScreenHarness
      partition={creationPartition}
      client={client}
      transport={transport}
    >
      {inner}
    </ScreenHarness>
  );
  const view = render(harnessed(drawn(from)));
  await settled();
  return {
    sent: scripted.sent,
    redraw: async (next) => {
      view.rerender(harnessed(drawn(next)));
      await settled();
    },
  };
}

function title(): string {
  return screen.getByPlaceholderText<HTMLInputElement>(
    "what this ticket is called",
  ).value;
}

function created(sent: readonly SentRequest[]): unknown {
  return sent.find(
    (one) => one.method === "POST" && one.url.endsWith("/drafts"),
  )?.body;
}

function configurationChosen(): string | null {
  return screen.getByRole("button", { name: /^Configuration/u }).textContent;
}

test("a duplicate opens holding its original's draft, less a revoked dependency, and sends that draft's brief", async () => {
  const { sent } = await drawDuplicate(11);
  expect(title()).toBe("Ship it");
  expect(
    screen.getByRole("link", { name: "ticket 11" }).getAttribute("href"),
  ).toBe("/tickets/11");
  expect(
    screen.getByText("Not carried · dependency on ticket 7, revoked"),
  ).toBeTruthy();
  expect(configurationChosen()).toContain("development");
  waiting.held = false;
  await press("Create ticket");
  expect(created(sent)).toStrictEqual({
    configurationRevision: "n-development",
    configurationDigest: creationInitialization.fence.configurationDigest,
    expectedProjectSequence: creationInitialization.fence.projectSequence,
    authoring: { dependencies: [40], program: eleven.authoring.program },
    brief,
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

test("an original that carried everything draws no line about it", async () => {
  await drawDuplicate(13);
  expect(title()).toBe("Another one");
  expect(screen.queryByText(/^Not carried/u)).toBeNull();
});

test("a second duplicate, a reload and a plain new ticket each start their own form", async () => {
  const { redraw } = await drawDuplicate(11);
  fireEvent.change(screen.getByPlaceholderText("what this ticket is called"), {
    target: { value: "typed over" },
  });
  await redraw(13);
  expect(title()).toBe("Another one");
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("another thing");
  expect(screen.queryByText(/^Not carried/u)).toBeNull();
  await redraw(undefined);
  expect(title()).toBe("");
  expect(screen.queryByRole("link", { name: /^ticket /u })).toBeNull();
  await redraw(11);
  expect(title()).toBe("Ship it");
});

test("an original on a retired binding opens with no repository, and says so", async () => {
  await drawDuplicate(13, {
    drafts: [thirteen],
    bindings: [
      creationListed(
        creationBinding(chuggy, "Push", "2026-09-01T00:00:00Z"),
        "Imported",
      ),
      creationListed(creationBinding(other), "Imported"),
    ],
    configurations: [creationDeclared("x-development", other, "development")],
  });
  expect(
    screen.getByText(
      "Not carried · repository kasofsk/chuggy, no longer bound",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /^Repository/u }).textContent,
  ).toContain("Choose");
});

/** Authored under a name the project no longer declares: the form asks, holds
 * what it carried undrawn, and draws it under the configuration chosen. */
test("an original whose configuration is gone asks for one and keeps what it carried", async () => {
  const gone: DraftResponse = {
    ...thirteen,
    configurationRevision: "o-opus",
    configurationVersion: { name: "development-opus", number: 1 },
    authoring: { ...thirteen.authoring, dependencies: [40] },
  };
  const { sent } = await drawDuplicate(13, { drafts: [gone] });
  expect(
    screen.getByText(
      "Not carried · configuration development-opus, no longer offered",
    ),
  ).toBeTruthy();
  expect(configurationChosen()).toContain("Choose");
  expect(screen.queryByRole("group", { name: "Checks" })).toBeNull();
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Configuration/u }), {
      key: "ArrowDown",
    });
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitemradio", {
        name: "development",
      }),
    );
  });
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Check 1" }).value,
  ).toBe("npm test");
  waiting.held = false;
  await press("Create ticket");
  expect(created(sent)).toMatchObject({
    configurationRevision: "n-development",
    authoring: { dependencies: [40], program: gone.authoring.program },
    brief: { checks: ["npm test"] },
  });
});
