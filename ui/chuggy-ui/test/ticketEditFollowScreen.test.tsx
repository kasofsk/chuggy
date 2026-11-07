/**
 * The edit screen of a Pending ticket following its draft as frames revise
 * it: a form nobody touched drawn again, a touched one kept with a choice of
 * whose to keep, a revision written over the draft revision it stands on, and
 * a touched one saved to its draft before the reader's thread is sent to.
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
import { DraftSaveHeld } from "../app/browser/editor/draftSaveBeforeSend.tsx";
import { creationDraftChangedSentence } from "../app/core/ticketCreationRun.ts";
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
import type { StreamServer } from "./streamDouble.ts";
import {
  editReadAnswered,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import {
  FollowSendProbe,
  followArrives,
  followBehind,
  followRetitled,
  followSendsAsked,
  followTitle,
} from "./draftFollowScreen.tsx";

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
    finalization: { kind: "GitMerge", mode: "Push", policy: "Direct" },
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
function routed(
  revising: { readonly refused: boolean } = { refused: false },
): (request: SentRequest) => Response {
  let draft = released;
  return ({ method, url, body }) => {
    if (method === "PUT" && revising.refused)
      return answer({ error: { code: "DraftChanged" } }, 409);
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
    return editReadAnswered(url, { repository: chuggy, draft, ticket });
  };
}

interface Drawn {
  readonly sent: readonly SentRequest[];
  readonly server: StreamServer;
}

async function drawEdit(
  revising: { readonly refused: boolean } = { refused: false },
): Promise<Drawn> {
  followSendsAsked.length = 0;
  const scripted = scriptedFetch(routed(revising));
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
      <DraftSaveHeld>
        <TicketEdit />
        <FollowSendProbe />
      </DraftSaveHeld>
    </ScreenHarness>,
  );
  await settled();
  return { sent: scripted.sent, server };
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
  expect(followTitle().value).toBe("Ship it");
  await followArrives(server, revisedBy("Revised by the agent"));
  expect(followTitle().value).toBe("Revised by the agent");
  expect(followBehind()).toBeNull();
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
  await followArrives(server, revisedBy("Revised by the agent"));
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ticket YAML" })
      .value,
  ).toContain("title: Revised by the agent\n");
});

test("a touched edit keeps what was typed, says the draft changed, and holds the submit back", async () => {
  const { server } = await drawEdit();
  followRetitled("Mine");
  await followArrives(server, revisedBy("Revised by the agent"));
  expect(followTitle().value).toBe("Mine");
  expect(followBehind()).not.toBeNull();
  expect(submitButton().disabled).toBe(true);
});

test("taking theirs in an edit drops what was typed for the revision", async () => {
  const { server } = await drawEdit();
  followRetitled("Mine");
  await followArrives(server, revisedBy("Revised by the agent"));
  await press("Take theirs");
  expect(followTitle().value).toBe("Revised by the agent");
  expect(followBehind()).toBeNull();
});

test("keeping one's own in an edit writes it over the revision it now stands on", async () => {
  const { sent, server } = await drawEdit();
  followRetitled("Mine");
  await followArrives(server, revisedBy("Revised by the agent"));
  await press("Keep mine");
  expect(followBehind()).toBeNull();
  waiting.held = false;
  await press("revise and release");
  expect(revisedAt(sent)).toMatchObject({
    expectedVersion: 4,
    brief: { title: "Mine" },
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

test("a touched edit is saved to its draft at the version it stands on before a send, and nothing is released", async () => {
  const { sent } = await drawEdit();
  followRetitled("Mine");
  await settled();
  await press("probe send");
  await settled();
  expect(followSendsAsked).toStrictEqual([true]);
  expect(sent.filter((one) => one.method === "PUT")).toHaveLength(1);
  expect(revisedAt(sent)).toMatchObject({
    expectedVersion: 3,
    brief: { title: "Mine" },
  });
  expect(sent.filter((one) => one.method === "POST")).toStrictEqual([]);
  expect(followTitle().value).toBe("Mine");
  await press("probe send");
  await settled();
  expect(followSendsAsked).toStrictEqual([true, true]);
  expect(sent.filter((one) => one.method === "PUT")).toHaveLength(1);
});

test("an untouched edit saves nothing before a send", async () => {
  const { sent } = await drawEdit();
  await press("probe send");
  await settled();
  expect(followSendsAsked).toStrictEqual([true]);
  expect(sent.filter((one) => one.method === "PUT")).toStrictEqual([]);
});

test("a save the draft refuses holds the send back, and the form says why where it says its own refusals", async () => {
  const { sent } = await drawEdit({ refused: true });
  followRetitled("Mine");
  await settled();
  await press("probe send");
  await settled();
  expect(followSendsAsked).toStrictEqual([false]);
  expect(sent.filter((one) => one.method === "PUT")).toHaveLength(1);
  expect(screen.getByText(creationDraftChangedSentence).className).toBe(
    "panel-failed",
  );
});
