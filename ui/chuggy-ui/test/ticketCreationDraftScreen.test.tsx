/**
 * The new-ticket screen opened on a draft the project already holds: the form
 * seeded from it, a submit that revises and releases that same draft, and the
 * form and its YAML following the draft as frames revise it — redrawn while
 * untouched, and kept, with a choice, once typed into.
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
import { ticketYamlStoreKey } from "../app/browser/editor/authoringGuards.tsx";
import { TicketCreationFrom } from "../app/browser/TicketCreationStart.tsx";
import {
  draftFollowBehindSentence,
  draftFollowClosedSentence,
} from "../app/core/draftFollow.ts";
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

const storeKey = ticketYamlStoreKey(creationPartition, 12);

/** Draft 12 as the member's agent wrote it, unreleased. */
const twelve: DraftResponse = {
  ...creationDraft,
  configurationRevision: "n-development",
  configurationVersion: { name: "development", number: 1 },
  brief: {
    title: "Ship it",
    intent: "ship the thing",
    links: [],
    repository: chuggy,
    branch: "refs/heads/topic/one",
    finalization: { mode: "Push" },
  },
};

/** The same draft as the agent revised it next. */
function revisedBy(title: string, over: Partial<DraftResponse> = {}) {
  return {
    ...twelve,
    authoringVersion: twelve.authoringVersion + 1,
    brief: { ...twelve.brief, title },
    ...over,
  } as DraftResponse;
}

/** The project's API over draft 12, which a revision moves on and a release
 * settles as succeeded. */
function routed(held: {
  draft: DraftResponse;
}): (request: SentRequest) => Response {
  return ({ method, url, body }) => {
    if (method === "PUT") {
      held.draft = {
        ...held.draft,
        ...(body as object),
        authoringVersion: held.draft.authoringVersion + 1,
      };
      return answer(held.draft);
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
    if (url.endsWith("/repositories?reach=false"))
      return answer({
        repositories: [creationListed(creationBinding(chuggy), "Imported")],
      });
    if (url.includes("/configurations"))
      return answer({
        configurations: [
          creationDeclared("n-development", chuggy, "development"),
        ],
      });
    if (url.includes("/draft-initializations/"))
      return answer({
        ...creationInitialization,
        configuration: {
          ...creationInitialization.configuration,
          revision: "n-development",
        },
      });
    if (url.endsWith("/drafts/12")) return answer(held.draft);
    return answer({
      partition: creationPartition,
      sequence: 43,
      tickets: [
        { ticket: 12, phase: "Pending", sequence: 43, ...ticketInstants },
      ],
    });
  };
}

interface Drawn {
  readonly sent: readonly SentRequest[];
  readonly server: StreamServer;
  /** The draft as the API answers it, which a case may move under the screen. */
  readonly held: { draft: DraftResponse };
}

async function drawDraft(draft: DraftResponse = twelve): Promise<Drawn> {
  const held = { draft };
  const scripted = scriptedFetch(routed(held));
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
      <TicketCreationFrom draft={12} />
    </ScreenHarness>,
  );
  await settled();
  return { sent: scripted.sent, server, held };
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

async function toYaml(): Promise<HTMLTextAreaElement> {
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  });
  return screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
}

function yaml(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: "Create ticket",
  });
}

function behind(): HTMLElement | null {
  return screen.queryByText(draftFollowBehindSentence(12));
}

function writes(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((one) => one.method !== "GET");
}

test("a draft opens in the creation form, and its submit revises and releases that same draft", async () => {
  const { sent } = await drawDraft();
  expect(title().value).toBe("Ship it");
  retitled("Ship it now");
  waiting.held = false;
  await press("Create ticket");
  const written = writes(sent);
  expect(written.map((one) => `${one.method} ${one.url}`)).toStrictEqual([
    expect.stringMatching(/^PUT .*\/drafts\/12$/u),
    expect.stringMatching(/^POST .*\/operations$/u),
  ]);
  expect(written[0]?.body).toMatchObject({
    expectedVersion: 3,
    configurationRevision: "n-development",
    brief: { title: "Ship it now", intent: "ship the thing" },
  });
  expect(written[1]?.body).toMatchObject({
    mutation: { ticket: 12, authoringVersion: 4 },
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

test("an untouched form is drawn again from each revision that arrives", async () => {
  const { server } = await drawDraft();
  await arrives(server, revisedBy("Revised by the agent"));
  expect(title().value).toBe("Revised by the agent");
  expect(behind()).toBeNull();
  expect(submitButton().disabled).toBe(false);
});

test("an untouched YAML view is written again from each revision that arrives", async () => {
  const { server } = await drawDraft();
  expect((await toYaml()).value).toContain("title: Ship it\n");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(yaml().value).toContain("title: Revised by the agent\n");
  expect(behind()).toBeNull();
});

test("a touched form keeps what was typed, says the draft changed, and holds the submit back", async () => {
  const { server } = await drawDraft();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(title().value).toBe("Mine");
  expect(behind()).not.toBeNull();
  expect(submitButton().disabled).toBe(true);
});

test("taking theirs drops what was typed for the revision", async () => {
  const { server } = await drawDraft();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  await press("Take theirs");
  expect(title().value).toBe("Revised by the agent");
  expect(behind()).toBeNull();
  expect(submitButton().disabled).toBe(false);
});

test("keeping one's own writes it over the revision rather than being refused behind it", async () => {
  const { sent, server } = await drawDraft();
  retitled("Mine");
  await arrives(server, revisedBy("Revised by the agent"));
  await press("Keep mine");
  expect(behind()).toBeNull();
  expect(title().value).toBe("Mine");
  waiting.held = false;
  await press("Create ticket");
  expect(writes(sent)[0]?.body).toMatchObject({
    expectedVersion: 4,
    brief: { title: "Mine" },
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

test("YAML typed over is kept under a revision, and taking theirs writes it again", async () => {
  const { server } = await drawDraft();
  const editor = await toYaml();
  const typed = editor.value.replace("ship the thing", "my own words");
  await turned(() => {
    fireEvent.change(editor, { target: { value: typed } });
  });
  expect(window.localStorage.getItem(`${storeKey}.version`)).toBe("3");
  await arrives(server, revisedBy("Revised by the agent"));
  expect(yaml().value).toBe(typed);
  expect(behind()).not.toBeNull();
  await press("Take theirs");
  expect(yaml().value).toContain("title: Revised by the agent\n");
  expect(yaml().value).toContain("ship the thing");
  expect(window.localStorage.getItem(storeKey)).toBeNull();
  expect(window.localStorage.getItem(`${storeKey}.version`)).toBeNull();
});

test("YAML this browser kept over an older revision opens behind the draft rather than over it", async () => {
  window.localStorage.setItem(storeKey, "title: Kept from before\n");
  window.localStorage.setItem(`${storeKey}.version`, "2");
  await drawDraft();
  expect(yaml().value).toBe("title: Kept from before\n");
  expect(behind()).not.toBeNull();
  await press("Keep mine");
  expect(behind()).toBeNull();
  expect(window.localStorage.getItem(`${storeKey}.version`)).toBe("3");
});

test("a draft released while the form is open says so, with the way to its ticket, and offers no submit", async () => {
  const { server } = await drawDraft();
  retitled("Mine");
  await arrives(
    server,
    revisedBy("Ship it", {
      authoringVersion: 3,
      state: "Released",
      releasedAuthoringVersion: 3,
    }),
  );
  expect(
    screen.getByText(
      draftFollowClosedSentence({ standing: "Released", ticket: 12 }),
    ),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ticket 12" })).toBeTruthy();
  expect(title().value).toBe("Mine");
  expect(submitButton().disabled).toBe(true);
});

test("a draft deleted before a submit reads it is said as nothing here being released, and nothing is written", async () => {
  const { sent, held } = await drawDraft();
  retitled("Mine");
  held.draft = { ...held.draft, state: "Deleted" };
  waiting.held = false;
  await press("Create ticket");
  expect(
    screen.getByText(/^Draft 12 deleted · Nothing here will be released/u),
  ).toBeTruthy();
  expect(screen.queryByText(/Submit again for a new one/u)).toBeNull();
  expect(writes(sent)).toStrictEqual([]);
  expect(left.to).toStrictEqual([]);
});

test("a draft deleted while the form is open says so, and offers no submit", async () => {
  const { server } = await drawDraft();
  await arrives(server, revisedBy("Ship it", { state: "Deleted" }));
  expect(
    screen.getByText(
      draftFollowClosedSentence({ standing: "Deleted", ticket: 12 }),
    ),
  ).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
});

test("a draft already released as the screen opens is said in place of the form", async () => {
  await drawDraft({
    ...twelve,
    state: "Released",
    releasedAuthoringVersion: 3,
  });
  expect(
    screen.getByText(
      draftFollowClosedSentence({ standing: "Released", ticket: 12 }),
    ),
  ).toBeTruthy();
  expect(
    screen.queryByPlaceholderText("what this ticket is called"),
  ).toBeNull();
});
