/**
 * The edit screen of a Pending ticket following its draft as frames revise
 * it: a form nobody touched drawn again, a touched one kept with a choice of
 * whose to keep, and a revision written over the draft revision it stands on.
 *
 * Revisions arrive as the project stream's own `Draft` frames, so what is
 * checked is the editor over the cache those frames write.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import { TicketEdit } from "../app/browser/TicketEdit.tsx";
import { draftFollowBehindSentence } from "../app/core/draftFollow.ts";
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
import { frame } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
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

vi.mock(
  "../app/browser/editor/TicketEditor.tsx",
  () => import("./ticketReleasing.tsx"),
);

const left = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useBlocker: () => undefined,
  useNavigate: () => (target: { readonly to: string }) => {
    left.to.push(target.to);
    return Promise.resolve();
  },
  useParams: () => ({ ...creationPartition, ticket: "12" }),
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

const ticket = {
  ticket: 12,
  phase: "Pending",
  sequence: 42,
  ...ticketInstants,
  revision: 2,
};

/** Ticket 12's draft, released at the version it is at. */
const released: DraftResponse = {
  ...creationDraft,
  state: "Released",
  releasedAuthoringVersion: creationDraft.authoringVersion,
  configurationRevision: "n-development",
  configurationVersion: { name: "development", number: 1 },
  brief: {
    title: "Ship it",
    intent: "ship the thing",
    links: [],
    repository: chuggy,
    finalization: { mode: "Push" },
  },
};

/** The same draft as an agent revised it next, still the ticket's own. */
function revisedBy(title: string): DraftResponse {
  return {
    ...released,
    authoringVersion: released.authoringVersion + 1,
    brief: { ...released.brief, title },
  } as DraftResponse;
}

/** The project's API over ticket 12, which a revision moves on and an update
 * settles as succeeded. */
function routed(): (request: SentRequest) => Response {
  let draft = released;
  return ({ method, url, body }) => {
    if (method === "PUT") {
      draft = {
        ...draft,
        ...(body as object),
        authoringVersion: draft.authoringVersion + 1,
      };
      return answer(draft);
    }
    if (method === "POST")
      return answer({ operation: "op", state: "Pending" }, 202);
    if (url.includes("/operations/"))
      return answer({
        operation: "op",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Succeeded",
        decidedSequence: 43,
      });
    if (url.includes("/draft-initializations/"))
      return answer({
        ...creationInitialization,
        configuration: {
          ...creationInitialization.configuration,
          revision: "n-development",
        },
      });
    if (url.includes("/configurations"))
      return answer({
        configurations: [
          creationDeclared("n-development", chuggy, "development"),
        ],
      });
    if (url.endsWith("/repositories?reach=false"))
      return answer({
        repositories: [creationListed(creationBinding(chuggy), "Imported")],
      });
    if (url.includes("/drafts/")) return answer(draft);
    if (url.includes("/tickets/")) return answer(ticket);
    return answer({
      partition: creationPartition,
      sequence: 43,
      tickets: [{ ...ticket, sequence: 43, revision: 3 }],
    });
  };
}

interface Drawn {
  readonly sent: readonly SentRequest[];
  readonly server: StreamServer;
}

async function drawEdit(): Promise<Drawn> {
  const scripted = scriptedFetch(routed());
  vi.stubGlobal("fetch", scripted.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={creationPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <TicketEdit />
    </ScreenHarness>,
  );
  await settled();
  return { sent: scripted.sent, server };
}

/** The agent's revision arriving as the stream's frame for it. */
async function arrives(server: StreamServer, draft: DraftResponse) {
  await turned(() => {
    server.push(
      frame("Draft", String(draft.authoringVersion), {
        version: 1,
        resource: "12",
        representation: draft,
      }),
    );
  });
  await settled();
}

function title(): HTMLInputElement {
  return screen.getByPlaceholderText<HTMLInputElement>(
    "what this ticket is called",
  );
}

function retitled(value: string): void {
  fireEvent.change(title(), { target: { value } });
}

function behind(): HTMLElement | null {
  return screen.queryByText(draftFollowBehindSentence(12));
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: "revise and release",
  });
}

function revisedAt(sent: readonly SentRequest[]): unknown {
  return sent.find((one) => one.method === "PUT")?.body;
}

test("an untouched edit is drawn again from each revision that arrives, and revises over the newest", async () => {
  const { sent, server } = await drawEdit();
  expect(title().value).toBe("Ship it");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(title().value).toBe("Revised by the agent");
  expect(behind()).toBeNull();
  waiting.held = false;
  await press("revise and release");
  expect(revisedAt(sent)).toMatchObject({
    expectedVersion: 4,
    brief: { title: "Revised by the agent" },
  });
});

test("an untouched edit's YAML is written again from each revision that arrives", async () => {
  const { server } = await drawEdit();
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  });
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
  expect(editor.value).toContain("title: Ship it\n");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ticket YAML" })
      .value,
  ).toContain("title: Revised by the agent\n");
});

test("a touched edit keeps what was typed, says the draft changed, and holds the submit back", async () => {
  const { server } = await drawEdit();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(title().value).toBe("Mine");
  expect(behind()).not.toBeNull();
  expect(submitButton().disabled).toBe(true);
});

test("taking theirs in an edit drops what was typed for the revision", async () => {
  const { server } = await drawEdit();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  await press("Take theirs");
  expect(title().value).toBe("Revised by the agent");
  expect(behind()).toBeNull();
});

test("keeping one's own in an edit writes it over the revision it now stands on", async () => {
  const { sent, server } = await drawEdit();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  await press("Keep mine");
  expect(behind()).toBeNull();
  waiting.held = false;
  await press("revise and release");
  expect(revisedAt(sent)).toMatchObject({
    expectedVersion: 4,
    brief: { title: "Mine" },
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});
