/**
 * The edit screen over a project whose repository declares several
 * configurations: which one a Pending ticket's edit opens on, what it reads to
 * get there, and what the revision it sends is pinned to.
 *
 * The listing is answered in the API's own order — newest commit first and,
 * inside one commit, by name descending — because that order is the case: its
 * first ready row is the name sorting last, and an edit drawn from that row
 * moved every ticket it touched to it.
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
import { TicketEdit } from "../app/browser/TicketEdit.tsx";
import { operationStateSentence } from "../app/core/codeSentences.ts";
import { configurationsPartialLabel } from "../app/core/repositoryConfigurations.ts";
import { creationFaultSentence } from "../app/core/ticketCreation.ts";
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

/**
 * Whether a wait ever ends. Held while the screen is drawn, so the fallback a
 * stream not yet open starts never reaches a refetch and what is counted is
 * what the screen itself read; let go for a submit, whose follow waits too.
 */
const waiting = vi.hoisted(() => ({ held: true }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.held ? new Promise<void>(() => undefined) : Promise.resolve(),
}));

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
const older = "0b5c1d0e9a7f4c3b2a1908f7e6d5c4b3a2f1e0d9";

/** Two imports of one repository, the newer having dropped a name. */
const listing = {
  configurations: [
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    creationDeclared("n-development", chuggy, "development"),
    creationDeclared("o-opus", chuggy, "development-opus", "Ready", older),
    creationDeclared("o-development", chuggy, "development", "Ready", older),
  ],
};

const ticket = {
  ticket: 12,
  phase: "Pending",
  sequence: 42,
  ...ticketInstants,
  revision: 2,
};

/** A released draft pinned at an older commit's revision of one name. */
function pinned(name: string, revision: string): DraftResponse {
  return {
    ...creationDraft,
    state: "Released",
    releasedAuthoringVersion: creationDraft.authoringVersion,
    configurationRevision: revision,
    configurationVersion: { name, number: 3 },
    brief: {
      title: "Ship it",
      intent: "ship the thing",
      links: [],
      repository: chuggy,
      finalization: { mode: "Push" },
    },
  };
}

function initialization(url: string): Response {
  const revision = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  return answer({
    ...creationInitialization,
    configuration: { ...creationInitialization.configuration, revision },
  });
}

interface Drawing {
  readonly draft: DraftResponse;
  /** What the read of one revision's initialization answers instead of it,
   * which may be nothing yet. */
  readonly unread?: (url: string) => Response | Promise<Response> | undefined;
  /** The state the update's operation settles in, which is succeeded unless a
   * case says the actor refused it. */
  readonly settles?: string;
}

/**
 * The draft a revision leaves: pinned where the body pins it, under the name
 * the listing declares that revision by. The read after a submit answers it,
 * as the door does, whether or not the update was then released.
 */
function revisedDraft(draft: DraftResponse, body: unknown): DraftResponse {
  const revision = (body as { readonly configurationRevision: string })
    .configurationRevision;
  const provenance = listing.configurations.find(
    (listed) => listed.revision === revision,
  )?.provenance;
  return {
    ...draft,
    authoringVersion: draft.authoringVersion + 1,
    configurationRevision: revision,
    ...(provenance?.source === "Repository"
      ? { configurationVersion: { name: provenance.name, number: 3 } }
      : {}),
  };
}

/** One project's API, holding the draft a revision moves. */
function routed(
  drawing: Drawing,
): (request: SentRequest) => Response | Promise<Response> {
  let draft = drawing.draft;
  return (request) => {
    const url = request.url;
    if (request.method === "PUT") {
      draft = revisedDraft(draft, request.body);
      return answer(draft);
    }
    if (request.method === "POST")
      return answer({ operation: "op", state: "Pending" }, 202);
    if (url.includes("/operations/"))
      return answer({
        operation: "op",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: drawing.settles ?? "Succeeded",
        ...(drawing.settles === undefined ? { decidedSequence: 43 } : {}),
      });
    if (url.includes("/draft-initializations/"))
      return drawing.unread?.(url) ?? initialization(url);
    if (url.includes("/configurations")) return answer(listing);
    if (url.endsWith("/repositories"))
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

async function drawEdit(drawing: Drawing): Promise<readonly SentRequest[]> {
  const scripted = scriptedFetch(routed(drawing));
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={creationPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketEdit />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

async function chooseConfiguration(name: string): Promise<void> {
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Configuration/u }), {
      key: "ArrowDown",
    });
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitemradio", { name }),
    );
  });
}

function configurationChosen(): string | null {
  return screen.getByRole("button", { name: /^Configuration/u }).textContent;
}

function initializationsRead(sent: readonly SentRequest[]): readonly string[] {
  return sent
    .filter((one) => one.url.includes("/draft-initializations/"))
    .map((one) => one.url.slice(one.url.lastIndexOf("/") + 1))
    .sort();
}

function revised(sent: readonly SentRequest[]): unknown {
  return sent.find((one) => one.method === "PUT")?.body;
}

async function retitleAndSubmit(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is called"), {
    target: { value: "Renamed" },
  });
  waiting.held = false;
  await press("revise and release");
}

test("an edit opens on the name its draft holds, and a retitle pins that name's newest revision", async () => {
  const sent = await drawEdit({
    draft: pinned("development", "o-development"),
  });
  expect(configurationChosen()).toContain("development");
  expect(configurationChosen()).not.toContain("sonnet");
  expect(initializationsRead(sent)).toStrictEqual([
    "n-development",
    "n-sonnet",
  ]);
  await retitleAndSubmit();
  expect(revised(sent)).toMatchObject({
    configurationRevision: "n-development",
    brief: { title: "Renamed" },
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

/** The newest commit dropped this name, so nothing offered is its newest
 * revision; the draft's own is read, and the ticket stays on it. */
test("a draft whose name is no longer offered keeps the revision it holds", async () => {
  const sent = await drawEdit({
    draft: pinned("development-opus", "o-opus"),
  });
  expect(configurationChosen()).toContain("development-opus");
  expect(initializationsRead(sent)).toStrictEqual([
    "n-development",
    "n-sonnet",
    "o-opus",
  ]);
  await retitleAndSubmit();
  expect(revised(sent)).toMatchObject({ configurationRevision: "o-opus" });
});

test("a held revision that cannot be read is said, and the reader is asked rather than moved", async () => {
  const sent = await drawEdit({
    draft: pinned("development-opus", "o-opus"),
    unread: (url) =>
      url.endsWith("/o-opus")
        ? answer({ error: { code: "ConfigurationNotFound" } }, 404)
        : undefined,
  });
  expect(screen.getByText(/^Not available · /u)).toBeTruthy();
  expect(configurationChosen()).toContain("Choose");
  await retitleAndSubmit();
  expect(screen.getByText(creationFaultSentence("configuration"))).toBeTruthy();
  expect(revised(sent)).toBe(undefined);
});

/**
 * Until the draft's own revision is read there is no configuration for the
 * form to open on, and one drawn then would be typed into under none.
 */
test("the form waits for the read of a revision no longer offered, and then opens on it", async () => {
  const own: { arrived: (answered: Response) => void } = {
    arrived: () => undefined,
  };
  await drawEdit({
    draft: pinned("development-opus", "o-opus"),
    unread: (url) =>
      url.endsWith("/o-opus")
        ? new Promise<Response>((resolve) => {
            own.arrived = resolve;
          })
        : undefined,
  });
  expect(
    screen.queryByPlaceholderText("what this ticket is called"),
  ).toBeNull();
  await turned(() => {
    own.arrived(initialization("/o-opus"));
  });
  await settled();
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Ship it");
  expect(configurationChosen()).toContain("development-opus");
});

/**
 * The draft is revised before its update is released, and read again once the
 * submit settles — now at a revision the project offers, where it opened on
 * one it does not. The form the submit reports to has to still be there.
 */
test("a ticket moved off a name no longer offered leaves the screen once its update lands", async () => {
  const sent = await drawEdit({
    draft: pinned("development-opus", "o-opus"),
  });
  await chooseConfiguration("development");
  await retitleAndSubmit();
  expect(revised(sent)).toMatchObject({
    configurationRevision: "n-development",
  });
  expect(left.to).toStrictEqual(["/$tenant/$project/tickets/$ticket"]);
});

test("a refused update of a ticket moved off such a name is said over what was typed", async () => {
  await drawEdit({
    draft: pinned("development-opus", "o-opus"),
    settles: "Cancelled",
  });
  await chooseConfiguration("development");
  await retitleAndSubmit();
  expect(document.querySelector(".panel-failed")?.textContent).toBe(
    `${operationStateSentence("Cancelled")} — the draft holds this revision at version ${String(creationDraft.authoringVersion + 1)}, not released`,
  );
  expect(configurationChosen()).toContain("development");
  expect(configurationChosen()).not.toContain("opus");
  expect(left.to).toStrictEqual([]);
});

const unreadable = (): Response =>
  answer({ error: { code: "InternalError" } }, 500);

/** The name the draft holds was read and another was not, so the edit opens
 * where it would have and says its choices may be short. */
test("an offer that could not be read is left out of an edit, and said", async () => {
  await drawEdit({
    draft: pinned("development", "o-development"),
    unread: (url) => (url.endsWith("/n-sonnet") ? unreadable() : undefined),
  });
  expect(screen.getByText(configurationsPartialLabel)).toBeTruthy();
  expect(screen.getByText(/^Configuration · /u).textContent).toContain(
    "development",
  );
});
