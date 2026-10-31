/**
 * The creation screen over a project's own reads, where the form suite beside
 * it is handed a context already read: what the screen does about a read that
 * came back short, about a submit the project moved under whose re-read then
 * fails, about a submit that finds its ticket already made, about which
 * reader its abilities read says is pressing, and about whether the project's
 * work has a runner to go to.
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

import { TicketCreation } from "../app/browser/TicketCreation.tsx";
import { configurationsPartialLabel } from "../app/core/repositoryConfigurations.ts";
import {
  creationProjectNotActiveSentence,
  creationStaleSentence,
  creationStaleUnreadSentence,
} from "../app/core/ticketCreationRun.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  draftPanelText,
  unanswered,
} from "./projectAbilitiesFixture.ts";
import {
  answer,
  heldAnswer,
  openedStream,
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
  creationGatedOffer,
  creationInitialization,
  creationListed,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { workRunnerOver, workRunnerUnreadable } from "./workRunnerReads.ts";
import type { WorkRunnerReads } from "./workRunnerReads.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useBlocker: () => undefined,
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ ...creationPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chuggy = "https://forge.test/kasofsk/chuggy";

const listing = {
  configurations: [
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    creationDeclared("n-development", chuggy, "development"),
  ],
};

/** One project's reads, any of which a case may answer for itself. */
function routed(
  answered: (request: SentRequest) => Response | undefined,
): (request: SentRequest) => Response {
  return (request) => {
    const url = request.url;
    const own = answered(request);
    if (own !== undefined) return own;
    if (url.endsWith("/repositories"))
      return answer({
        repositories: [creationListed(creationBinding(chuggy), "Imported")],
      });
    if (url.includes("/configurations")) return answer(listing);
    if (!url.includes("/draft-initializations/"))
      return answer({
        partition: creationPartition,
        sequence: 42,
        tickets: [],
      });
    const revision = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    return answer({
      ...creationInitialization,
      configuration: { ...creationInitialization.configuration, revision },
    });
  };
}

/** The screen over the project's reads, which are what it returns as sent:
 * a `fetch` laid over them answers the abilities read before they see it. */
async function drawCreation(
  answered: (request: SentRequest) => Response | undefined,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): Promise<readonly SentRequest[]> {
  const scripted = scriptedFetch(routed(answered));
  vi.stubGlobal("fetch", over(scripted.fetch));
  render(
    <ScreenHarness
      partition={creationPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <TicketCreation />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

const unreadable = (): Response =>
  answer({ error: { code: "InternalError" } }, 500);

function configurationPicker(): HTMLElement {
  return screen.getByRole("button", { name: /^Configuration/u });
}

async function offeredNames(): Promise<readonly (string | null)[]> {
  await turned(() => {
    fireEvent.keyDown(configurationPicker(), { key: "ArrowDown" });
  });
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitemradio")
    .map((item) => item.textContent);
}

/**
 * One of two offers went unread, which leaves one: the screen says the read
 * was short and asks, the one left not being known to be the only one.
 */
test("an offer that could not be read is left out, said, and the one left is asked about", async () => {
  await drawCreation(({ url }) =>
    url.endsWith("/n-sonnet") ? unreadable() : undefined,
  );
  expect(screen.getByText(configurationsPartialLabel)).toBeTruthy();
  expect(configurationPicker().textContent).toContain("Choose");
  expect(await offeredNames()).toStrictEqual(["development"]);
});

/**
 * A submit the project moved under reads the project again and says so. Where
 * that read fails, the form stays as the reader left it and says it was not
 * updated, and the note does not claim the read it could not make.
 */
test("a submit the project moved under, whose re-read fails, keeps the form and says it was not updated", async () => {
  const failing = { on: false };
  const sent = await drawCreation(({ method, url }) => {
    if (method === "POST" && url.endsWith("/drafts"))
      return answer({ error: { code: "DraftInitializationStale" } }, 409);
    return failing.on && url.endsWith("/repositories")
      ? unreadable()
      : undefined;
  });
  await offeredNames();
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "development" }));
  });
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  failing.on = true;
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  });
  await settled();
  expect(sent.filter((one) => one.method === "POST").length).toBe(1);
  expect(screen.getByText("Not updated")).toBeTruthy();
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("ship it");
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();
  expect(screen.queryByText(creationStaleSentence)).toBeNull();
  expect(screen.getByText(creationStaleUnreadSentence)).toBeTruthy();
});

/** The project's reads failing from here on, and every read asked again, as a
 * refresh in the background asks. */
async function rereadFailing(
  failing: { on: boolean },
  client: QueryClient,
): Promise<void> {
  failing.on = true;
  await turned(() => void client.invalidateQueries());
  await settled();
}

function purposeBox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText<HTMLTextAreaElement>(
    "what this ticket is for",
  );
}

/** A read in the background that fails leaves the form as the reader left it. */
test("text typed into the form survives a read of the project that fails behind it", async () => {
  const failing = { on: false };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const sent = await drawCreation(
    ({ url }) =>
      failing.on && url.endsWith("/repositories") ? unreadable() : undefined,
    undefined,
    client,
  );
  fireEvent.change(purposeBox(), { target: { value: "ship it" } });
  const before = sent.length;
  await rereadFailing(failing, client);
  expect(sent.length).toBeGreaterThan(before);
  expect(purposeBox().value).toBe("ship it");
});

/** A submit still out when a read in the background fails keeps its outcome,
 * so the reader is told what became of it rather than pressing again. */
test("a submit in flight keeps its outcome through a read of the project that fails", async () => {
  const failing = { on: false };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const drafted = heldAnswer();
  let drafts = 0;
  await drawCreation(
    ({ url }) =>
      failing.on && url.endsWith("/repositories") ? unreadable() : undefined,
    (served) =>
      ((url: string, init?: { readonly method?: string }) => {
        if (init?.method !== "POST" || !url.endsWith("/drafts"))
          return served(url, init);
        drafts += 1;
        return drafted.answered;
      }) as typeof fetch,
    client,
  );
  await offeredNames();
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "development" }));
  });
  fireEvent.change(purposeBox(), { target: { value: "ship it" } });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  });
  await rereadFailing(failing, client);
  drafted.release(answer({ error: { code: "ProjectNotActive" } }, 409));
  await settled();
  expect(screen.getByText(creationProjectNotActiveSentence)).toBeTruthy();
  expect(purposeBox().value).toBe("ship it");
  expect(drafts).toBe(1);
});

/**
 * The form reaches no address bar, so the way to a ticket its submit found is
 * this screen's to draw. The release is declined before it is accepted, which
 * leaves the draft held, and the draft is then released from somewhere else.
 */
test("a submit that finds its ticket already made draws the way to it in the note", async () => {
  const draft = { released: false };
  await drawCreation(({ method, url }) => {
    if (method === "POST" && url.endsWith("/operations"))
      return answer({ error: { code: "MutationNotAdmitted" } }, 409);
    if (method === "POST" && url.endsWith("/drafts"))
      return answer(creationDraft, 201);
    return url.endsWith("/drafts/12")
      ? answer({
          ...creationDraft,
          ...(draft.released
            ? { state: "Released", releasedAuthoringVersion: 3 }
            : {}),
        })
      : undefined;
  });
  await offeredNames();
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "development" }));
  });
  for (const intent of ["ship it", "ship that"]) {
    fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
      target: { value: intent },
    });
    await turned(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    });
    await settled();
    draft.released = true;
  }
  const told = screen.getByText(/already exists/u);
  expect(told.textContent).toBe(
    "#12 already exists: an earlier release of this draft went through, and what has been changed here since is not in it — Ticket 12",
  );
  expect(within(told).getByRole("link", { name: "Ticket 12" })).toBeTruthy();
});

test("a reader who may not mutate, arriving by address, is told View only and none of the form's reads is sent", async () => {
  const sent = await drawCreation(
    () => undefined,
    abilitiesOver({ ...abilitiesEvery, mutate: false }),
  );
  expect(draftPanelText()).toBe("DraftView only");
  expect(sent).toStrictEqual([]);
});

/** The address mounts the abilities read and the form at once, so the form's
 * reads wait for the one that says whether they would be refused. */
test("the form's reads wait for the abilities read, and are sent once it says the reader may mutate", async () => {
  const held = heldAnswer();
  const sent = await drawCreation(
    () => undefined,
    abilitiesOver(held.answered),
  );
  expect(draftPanelText()).toBe("DraftLoading…");
  expect(sent).toStrictEqual([]);

  await turned(() => {
    held.release(answer(abilitiesEvery));
  });
  await settled();
  expect(configurationPicker()).toBeDefined();
  expect(
    sent.filter((one) => one.url.includes("/draft-initializations/")),
  ).not.toStrictEqual([]);
});

/**
 * Which reader is pressing is the abilities read's to say, and the form is not
 * drawn before that read comes back. One that failed decides nothing here, as
 * it decides nothing of any control.
 */
test.each([
  ["it says may dispatch", abilitiesEvery, "Starts work"],
  [
    "it says may not dispatch",
    { ...abilitiesEvery, dispatch: false },
    "Released for a dispatcher to start",
  ],
  ["it failed for", Promise.resolve(unreadable()), "Starts work"],
])(
  "the abilities read tells a reader %s what Create ticket does",
  async (_reader, abilities, effect) => {
    await drawCreation(() => undefined, abilitiesOver(abilities));
    expect(
      screen.getByRole("button", {
        name: "Create ticket",
        description: effect,
      }),
    ).toBeDefined();
  },
);

/** A reader who may dispatch, over a project whose runner reads answer as
 * the case says. */
function dispatcherOver(
  reads: WorkRunnerReads,
): (served: typeof fetch) => typeof fetch {
  return (served) =>
    abilitiesOver(abilitiesEvery)(workRunnerOver(reads)(served));
}

/** The line beside Create ticket, and whether the way to a runner is drawn
 * after it. */
function effectDrawn(): readonly [string | null, boolean] {
  const described = screen
    .getByRole("button", { name: "Create ticket" })
    .getAttribute("aria-describedby");
  return [
    document.getElementById(described ?? "")?.textContent ?? null,
    screen.queryByRole("link", { name: "Add runner" }) !== null,
  ];
}

const starting = ["Starts work", false] as const;
const waiting = ["Released for a dispatcher to start", false] as const;

const runnerReads: readonly (readonly [
  string,
  WorkRunnerReads,
  readonly [string, boolean],
])[] = [
  [
    "with no runner registered",
    { runners: "Unregistered" },
    ["No runner", true],
  ],
  [
    "with no runner but the reader's own, which it lets take their work",
    { runners: "Unregistered", fallback: "Strict" },
    starting,
  ],
  [
    "with no runner, which lets a reader with none of their own take their work",
    { runners: "Unregistered", mine: "Unregistered", fallback: "Preferred" },
    ["No runner", true],
  ],
  ["with a runner that is offline", { runners: "Offline" }, starting],
  ["with a runner that is live", { runners: "Live" }, starting],
  [
    "whose work is hosted, with no runner",
    { runners: "Unregistered", work: "InCluster" },
    starting,
  ],
  ["whose runners read failed", { runners: workRunnerUnreadable }, starting],
  [
    "whose route read failed",
    { runners: "Unregistered", work: workRunnerUnreadable },
    starting,
  ],
  ["whose runners read has not come back", { runners: unanswered }, waiting],
  [
    "whose route read has not come back",
    { runners: "Unregistered", work: unanswered },
    waiting,
  ],
];

/**
 * A press that starts work in a project with no runner parks the ticket it
 * made, so the form says there is none and where one is added. It is drawn
 * while either read is out, on the line that starts nothing.
 */
test.each(runnerReads)(
  "a project %s tells a reader who may dispatch what Create ticket does",
  async (_project, reads, drawn) => {
    await drawCreation(() => undefined, dispatcherOver(reads));
    expect(effectDrawn()).toStrictEqual(drawn);
  },
);

test("the line a read was out for is the one its answer earns, once it is back", async () => {
  const held = heldAnswer();
  await drawCreation(
    () => undefined,
    dispatcherOver({ runners: () => held.answered }),
  );
  expect(effectDrawn()).toStrictEqual(waiting);
  await turned(() => {
    held.release(answer(sessionPlacementBody({ project: "Unregistered" })));
  });
  await settled();
  expect(effectDrawn()).toStrictEqual(["No runner", true]);
});

/** A reader who may not dispatch starts nothing by pressing, so a runner is
 * not what stands between the press and the work. */
test("a reader who may not dispatch reads the same line with no runner as with one", async () => {
  await drawCreation(
    () => undefined,
    (served) =>
      abilitiesOver({ ...abilitiesEvery, dispatch: false })(
        workRunnerOver({ runners: "Unregistered" })(served),
      ),
  );
  expect(effectDrawn()).toStrictEqual(waiting);
});

/** Every initialization answered as the gated catalog's, at the revision asked for. */
function gatedInitialization({ url }: SentRequest): Response | undefined {
  if (!url.includes("/draft-initializations/")) return undefined;
  const revision = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  const { initialization } = creationGatedOffer();
  return answer({
    ...initialization,
    configuration: { ...initialization.configuration, revision },
  });
}

test.each([
  ["may", abilitiesEvery, 2],
  ["may not", { ...abilitiesEvery, skipPlannedEvaluations: false }, 0],
] as const)(
  "a reader the abilities read says %s skip planned evaluations is offered a Remove on each stage the plan runs, or none",
  async (_said, abilities, removes) => {
    await drawCreation(gatedInitialization, abilitiesOver(abilities));
    await offeredNames();
    await turned(() => {
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: "development" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryAllByRole("button", { name: "Remove" })).toHaveLength(
      removes,
    );
  },
);
