/**
 * The creation form as a person drives it: what one click sends, what it does
 * with the answer, and what survives the round trip.
 *
 * The decisions checked here are the component's own and no pure module holds
 * them — whether a settlement becomes a navigation, whether a resubmission
 * re-releases the draft it already made, and whether typing survives a fresh
 * initialization. The API is a double that records every request, so what is
 * asserted is the traffic and the screen rather than a return value.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { briefChecksMax, briefLinksMax } from "../../../src/contract/brief.ts";
import { bootstrapConfigurationName } from "../../../src/contract/responses.ts";
import type {
  ConfigurationSummary,
  ProjectRepositoryResponse,
} from "../../../src/contract/responses.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import { ticketConfigurationKept } from "../app/browser/editor/authoringGuards.tsx";
import { configurationsPartialLabel } from "../app/core/repositoryConfigurations.ts";
import {
  creationConfigurationName,
  creationFaultSentence,
  creationStageOf,
  creationSubmitEffect,
} from "../app/core/ticketCreation.ts";
import type { CreationOffer } from "../app/core/ticketCreation.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import type { CreationContext } from "../app/core/ticketCreationRun.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationListed,
  creationOffer,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { answeringApi } from "./answeringApi.ts";
import { chooseConfiguration, configurationPicker } from "./creationPicker.ts";
import type { Sent } from "./answeringApi.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  ticketDoor,
  ticketDoorAnswers,
  ticketDoorDecides,
  ticketRefusedFirst,
} from "./ticketReleasing.tsx";
import type { TicketDoor } from "./ticketReleasing.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";

/** The runner has no globals, so each case tears down the tree it rendered,
 * and starts in a browser that remembers no choice. */
beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Api {
  readonly ports: ApiPorts;
  readonly sent: Sent[];
}

const operationBody = (state: string): unknown => ({
  operation: "op",
  acceptedAt: "2026-08-26T00:00:00Z",
  state,
  ...(state === "Succeeded" ? { decidedSequence: 42 } : {}),
});

const projectBody = {
  partition: creationPartition,
  sequence: 42,
  tickets: [
    {
      ticket: creationDraft.ticket,
      phase: "Pending",
      sequence: 42,
      ...ticketInstants,
    },
  ],
};

/**
 * An API that creates a draft, accepts a release and then answers the poll with
 * whatever state the case names; `draftStatus` is what `POST /drafts` answers.
 */
function api(options: {
  readonly state: string;
  readonly draftStatus?: number;
}): Api {
  return answeringApi((method, path) => {
    if (method === "POST" && path.endsWith("/drafts"))
      return {
        status: options.draftStatus ?? 201,
        body:
          (options.draftStatus ?? 201) === 201
            ? creationDraft
            : { error: { code: "DraftInitializationStale" } },
      };
    if (method === "POST" && path.endsWith("/operations"))
      return { status: 202, body: { operation: "op", state: "Pending" } };
    if (path.includes("/operations/"))
      return { status: 200, body: operationBody(options.state) };
    return { status: 200, body: projectBody };
  });
}

const queryKey = creationContextList(creationPartition).key;

/** The configuration a project holding this initialization lists. */
function shaping(
  initialization: typeof creationInitialization,
): ConfigurationSummary {
  return {
    revision: initialization.configuration.revision,
    digest: initialization.configuration.digest,
    createdAt: "2026-08-26T00:00:00Z",
    provenance: { source: "Authored" },
    version: { name: "chuggy", number: 12 },
    readiness: "Ready",
    image: "an-image",
    practices: [],
    workInstructionsCount: 1,
    reviewInstructionsCount: 1,
    finalization: { approvalRequired: false },
    evaluationStagesCount: 1,
  };
}

type ReadyContext = Extract<CreationContext, { context: "Ready" }>;

/** The form over whatever a project offers, which is where a case about the
 * choice itself starts. */
function drawOffered(
  ports: ApiPorts,
  created: number[],
  context: Omit<ReadyContext, "context">,
  partition = creationPartition,
): { readonly rerender: (next: Omit<ReadyContext, "context">) => void } {
  const tree = (next: Omit<ReadyContext, "context">) => (
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={partition}
        queryKey={queryKey}
        context={{ context: "Ready", ...next }}
        dispatches={false}
        onCreated={(ticket) => created.push(ticket)}
        existing={(ticket) => <a href="/there">Ticket {ticket}</a>}
      />
    </QueryClientProvider>
  );
  const drawn = render(tree(context));
  return {
    rerender: (next) => {
      drawn.rerender(tree(next));
    },
  };
}

/** The form of a project offering the one configuration its initialization is
 * of, which is every case but the choice's own. */
function draw(
  ports: ApiPorts,
  created: number[],
  initialization = creationInitialization,
  repositories: readonly ProjectRepositoryResponse[] = [],
  configuration?: ConfigurationSummary,
): { readonly rerender: (next: typeof creationInitialization) => void } {
  const context = (
    next: typeof creationInitialization,
  ): Omit<ReadyContext, "context"> => {
    const listed = configuration ?? shaping(next);
    const offer: CreationOffer = {
      name: creationConfigurationName(listed),
      listed,
      initialization: next,
    };
    return { offers: [offer], partial: false, repositories };
  };
  const drawn = drawOffered(ports, created, context(initialization));
  return {
    rerender: (next) => {
      drawn.rerender(context(next));
    },
  };
}

function typeIntent(text: string): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: text },
  });
}

function typeTitle(text: string): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is called"), {
    target: { value: text },
  });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
}

function releases(sent: readonly Sent[]): readonly Sent[] {
  return sent.filter(
    (one) => one.method === "POST" && one.path.endsWith("/operations"),
  );
}

function drafts(sent: readonly Sent[]): readonly Sent[] {
  return sent.filter(
    (one) => one.method === "POST" && one.path.endsWith("/drafts"),
  );
}

/** The line names the configuration nobody was asked about, so the revision it
 * names it instead of has nowhere else on this screen to be. */
test("the configuration line keeps the revision behind the name it draws", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  expect(screen.queryByRole("button", { name: /^Configuration/u })).toBeNull();
  const line = screen.getByText("Configuration · chuggy #12");
  fireEvent.focus(line);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    creationInitialization.configuration.revision,
  );
});

/**
 * A field is named by its label alone and its line is its description: a hint
 * folded into the name is a paragraph a screen reader speaks as the field.
 */
test("each field is named by its label, and a line beside one describes it", () => {
  const commanding = { ...creationInitialization, commandedCheckStage: 1 };
  draw(api({ state: "Succeeded" }).ports, [], commanding);
  fireEvent.click(screen.getByText("Add link"));
  fireEvent.click(screen.getByText("Add check"));
  expect(screen.getByRole("textbox", { name: "Link 1" })).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Check 1" })).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Title" })).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Intent" })).toBeDefined();
  expect(
    screen.getByRole("textbox", {
      name: "Branch",
      description: "Where the work happens · created if missing",
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("textbox", {
      name: "Target branch",
      description: "Empty means the branch above",
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", {
      name: "Create ticket",
      description: creationSubmitEffect(false),
    }),
  ).toBeDefined();
});

/** On the bootstrap a ticket's one job is the repository's own configuration,
 * which is not the feature a newcomer came to file. */
test("a form on the bootstrap says what its ticket is for", () => {
  const line = "First ticket · writes this repository's configuration";
  draw(api({ state: "Succeeded" }).ports, []);
  expect(screen.queryByText(line)).toBeNull();
  cleanup();
  draw(
    api({ state: "Succeeded" }).ports,
    [],
    creationInitialization,
    [],
    creationSummary("bootstrap", "Ready"),
  );
  expect(screen.getByText(line)).toBeDefined();
});

test("a release that settles as succeeded navigates, and to that ticket", async () => {
  const held = api({ state: "Succeeded" });
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
});

/** What the form says a submit ended in, whole. */
function note(): string | null | undefined {
  return document.querySelector(".panel-failed")?.textContent;
}

/** A submit, waited on until the form is back from it. */
async function submitted(): Promise<void> {
  const button = screen.getByRole("button", { name: "Create ticket" });
  fireEvent.click(button);
  expect(button).toHaveProperty("disabled", true);
  await waitFor(() => {
    expect(button).toHaveProperty("disabled", false);
  });
}

const draftUnreleased =
  "draft 12 was created and not released; submitting again goes back to that draft rather than creating another";
const draftUnknown =
  "draft 12 was created, and whether it was released is not known; submitting again goes back to that draft rather than creating another";

test("a release that settles undecided draws the reason and its unreleased draft, and navigates nowhere", async () => {
  const held = api({ state: "Cancelled" });
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  await submitted();
  expect(note()).toBe(
    `the operation was cancelled before it was decided — ${draftUnreleased}`,
  );
  expect(created).toStrictEqual([]);
});

test("a follow that runs out of budget navigates nowhere either, and does not call its draft unreleased", async () => {
  const held = api({ state: "Pending" });
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  await submitted();
  expect(note()).toBe(
    `the operation is still pending after the attempt budget — ${draftUnknown}`,
  );
  expect(created).toStrictEqual([]);
});

test("what was typed survives a re-render and a fresh initialization", async () => {
  const held = api({ state: "Succeeded", draftStatus: 409 });
  const drawn = draw(held.ports, []);
  typeTitle("Ship it");
  typeIntent("ship it");
  fireEvent.change(screen.getByPlaceholderText("the branch name"), {
    target: { value: "topic/one" },
  });
  drawn.rerender({
    ...creationInitialization,
    fence: { ...creationInitialization.fence, projectSequence: 99 },
  });
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Ship it");
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("ship it");
  submit();
  await screen.findByText(/read again/u);
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("ship it");
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("the branch name").value,
  ).toBe("topic/one");
});

/**
 * The two branch fields are one screen apart and two references on the wire,
 * so what is asserted is the body that left rather than the state behind it.
 */
test("both branch fields reach the wire, the target as the finalization", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  typeTitle("Ship it");
  typeIntent("ship it");
  fireEvent.change(screen.getByPlaceholderText("the branch name"), {
    target: { value: "topic/one" },
  });
  fireEvent.change(screen.getByPlaceholderText("the branch to land on"), {
    target: { value: "release/next" },
  });
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  const body = drafts(held.sent)[0]?.body;
  expect(
    body !== null && typeof body === "object" && "brief" in body
      ? body.brief
      : undefined,
  ).toStrictEqual({
    title: "Ship it",
    intent: "ship it",
    links: [],
    branch: "refs/heads/topic/one",
    finalization: { mode: "Push", target: "refs/heads/release/next" },
  });
});

/** The draft door's revisions of the draft a submit left held. */
function revisions(sent: readonly Sent[]): readonly unknown[] {
  return sent
    .filter(
      (one) =>
        one.method === "PUT" &&
        one.path.endsWith(`/drafts/${String(creationDraft.ticket)}`),
    )
    .map((one) => one.body);
}

/** The identity each release went under, in the order they were sent. */
function operations(sent: readonly Sent[]): readonly unknown[] {
  return releases(sent).map((one) =>
    one.body !== null && typeof one.body === "object" && "operation" in one.body
      ? one.body.operation
      : undefined,
  );
}

test("a held draft the form still describes is released again, unrevised, under the identity it was released under", async () => {
  const held = api({ state: "Cancelled" });
  draw(held.ports, []);
  typeIntent("ship it");
  submit();
  await screen.findByText(/was created and not released/u);
  submit();
  await waitFor(() => {
    expect(releases(held.sent).length).toBe(2);
  });
  expect(drafts(held.sent).length).toBe(1);
  expect(revisions(held.sent)).toStrictEqual([]);
  const [first, second] = operations(held.sent);
  expect(first).toBe(second);
});

/** One request as a case compares it: a revision by the version it was
 * fenced at, and a release by the version it named. */
function requestLine(one: Sent): string {
  const said = `${one.method} ${one.path.slice(one.path.indexOf("/atlas") + 6)}`;
  const body = one.body as {
    readonly expectedVersion?: number;
    readonly mutation?: { readonly authoringVersion: number };
  } | null;
  if (one.method === "PUT")
    return `${said} at ${String(body?.expectedVersion)}`;
  return body?.mutation === undefined
    ? said
    : `${said} at ${String(body.mutation.authoringVersion)}`;
}

/** What was sent from one point on, a run of the same request as one line. */
function requestLines(sent: readonly Sent[], from: number): readonly string[] {
  return sent
    .slice(from)
    .map(requestLine)
    .filter((said, at, all) => said !== all[at - 1]);
}

const draftRead = "GET /drafts/12";
const releasedAndConfirmed = (version: number): readonly string[] => [
  `POST /operations at ${String(version)}`,
  "GET /operations/",
  "GET ?after=11&limit=1&minimumSequence=42",
];

const refusedNote = `the configuration this named is not one the project will run, or it hands the work off where this brief opens a pull request — ${draftUnreleased}`;

/** The form over a door, and what was sent since the case last asked. */
function drawHeld(
  decide: (nth: number) => string,
  over?: Parameters<typeof ticketDoorAnswers>[2],
): {
  readonly door: TicketDoor;
  readonly created: number[];
  readonly since: () => readonly string[];
} {
  const door = ticketDoor();
  const held = answeringApi(ticketDoorAnswers(door, decide, over));
  const created: number[] = [];
  const read = { from: 0 };
  draw(held.ports, created);
  return {
    door,
    created,
    since: () => {
      const lines = requestLines(
        held.sent.map((one) => ({
          ...one,
          path: one.path.replace(/\/operations\/.*$/u, "/operations/"),
        })),
        read.from,
      );
      read.from = held.sent.length;
      return lines;
    },
  };
}

test("an intent retyped after a refused release is read, revised into the held draft, and released afresh", async () => {
  const held = answeringApi(
    ticketDoorAnswers(ticketDoor(), ticketRefusedFirst),
  );
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  await submitted();
  expect(note()).toBe(refusedNote);
  typeIntent("ship that");
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(drafts(held.sent).length).toBe(1);
  expect(revisions(held.sent)).toMatchObject([
    {
      expectedVersion: creationDraft.authoringVersion,
      configurationRevision: creationInitialization.configuration.revision,
      brief: { intent: "ship that" },
    },
  ]);
  const [first, second] = operations(held.sent);
  expect(second).not.toBe(first);
});

/** A release left pending past the console's budget, which the actor carries
 * out once nobody is asking. */
async function neverLearned(held: ReturnType<typeof drawHeld>): Promise<void> {
  typeIntent("ship it");
  await submitted();
  expect(note()).toBe(
    `the operation is still pending after the attempt budget — ${draftUnknown}`,
  );
  ticketDoorDecides(held.door, held.door.releases[0], "Succeeded");
  held.since();
}

const existsNote =
  "#12 already exists: an earlier release of this draft went through, and what has been changed here since is not in it — Ticket 12";

/**
 * The ticket is as the form first said, and what it says now is in none: the
 * form is left on its screen saying so, beside the way to that ticket, and
 * the draft of a ticket that is running is written nothing.
 */
test("a changed form over a release that had gone through is told of its ticket, and writes nothing however often", async () => {
  const held = drawHeld(() => "Pending");
  await neverLearned(held);
  for (const intent of ["ship that", "ship the other"]) {
    typeIntent(intent);
    await submitted();
    expect(note()).toBe(existsNote);
    expect(held.since()).toStrictEqual([draftRead]);
  }
  expect(
    within(screen.getByText(/already exists/u)).getByRole("link", {
      name: "Ticket 12",
    }),
  ).toHaveProperty("pathname", "/there");
  expect(held.created).toStrictEqual([]);
  expect(held.door.version).toBe(creationDraft.authoringVersion);
});

test("a form put back as first written after being told of its ticket goes to it", async () => {
  const held = drawHeld(() => "Pending");
  await neverLearned(held);
  typeIntent("ship that");
  await submitted();
  expect(note()).toBe(existsNote);
  held.since();
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(held.created).toStrictEqual([creationDraft.ticket]);
  });
  expect(held.since()).toStrictEqual(releasedAndConfirmed(3));
});

test("a changed form over a ticket already past Pending is told of it the same, its door never asked", async () => {
  const held = drawHeld(() => "Pending");
  await neverLearned(held);
  held.door.closed = true;
  typeIntent("ship that");
  await submitted();
  expect(note()).toBe(existsNote);
  expect(held.since()).toStrictEqual([draftRead]);
  expect(held.created).toStrictEqual([]);
});

/** The door applies the first revision it is sent and answers it as a fault. */
function drawAnswerLost(): ReturnType<typeof drawHeld> {
  const lost = { count: 0 };
  return drawHeld(ticketRefusedFirst, (method, _path, answered) => {
    const answer = answered();
    if (method !== "PUT") return answer;
    lost.count += 1;
    return lost.count === 1
      ? { status: 500, body: { error: { code: "InternalError" } } }
      : answer;
  });
}

/**
 * The draft is a version on from the one this form holds of it, and the form
 * cannot know. The next submit reads it before writing, so what the door
 * applied is written over rather than fenced against for good.
 */
test.each([
  ["the same form again", "ship that"],
  ["a form changed again", "ship the other"],
])(
  "a revision the door applied and answered as a fault is said over what was typed, and %s is written over it",
  async (_said, intent) => {
    const held = drawAnswerLost();
    typeIntent("ship it");
    await submitted();
    expect(note()).toBe(refusedNote);
    held.since();
    typeIntent("ship that");
    await submitted();
    expect(note()).toBe(
      `the API refused this, and named a reason this console does not know (InternalError) — ${draftUnreleased}`,
    );
    expect(held.since()).toStrictEqual([draftRead, "PUT /drafts/12 at 3"]);
    expect(
      screen.getByPlaceholderText<HTMLTextAreaElement>(
        "what this ticket is for",
      ).value,
    ).toBe("ship that");
    typeIntent(intent);
    submit();
    await waitFor(() => {
      expect(held.created).toStrictEqual([creationDraft.ticket]);
    });
    expect(held.since()).toStrictEqual([
      draftRead,
      "PUT /drafts/12 at 4",
      ...releasedAndConfirmed(5),
    ]);
  },
);

test("a held draft that cannot be read is said, written nothing, and read again by the next submit", async () => {
  const reads = { failing: true };
  const held = drawHeld(ticketRefusedFirst, (method, path, answered) =>
    reads.failing && method === "GET" && path.endsWith("/drafts/12")
      ? { status: 500, body: { error: { code: "InternalError" } } }
      : answered(),
  );
  typeIntent("ship it");
  await submitted();
  held.since();
  typeIntent("ship that");
  await submitted();
  expect(note()).toBe(
    `the draft could not be read, so nothing was written to it: the API failed with InternalError — ${draftUnreleased}`,
  );
  expect(held.since()).toStrictEqual([draftRead]);
  reads.failing = false;
  submit();
  await waitFor(() => {
    expect(held.created).toStrictEqual([creationDraft.ticket]);
  });
  expect(held.since()).toStrictEqual([
    draftRead,
    "PUT /drafts/12 at 3",
    ...releasedAndConfirmed(4),
  ]);
});

test("the advanced disclosure holds the authoring, and offers what is chosen", () => {
  const chosen = {
    ...creationInitialization,
    defaults: {
      ...creationInitialization.defaults,
      program: [
        {
          key: 1,
          evaluators: Array.from({ length: 9 }, (_, index) => ({
            key: index + 1,
          })),
        },
      ],
    },
  };
  draw(api({ state: "Succeeded" }).ports, [], chosen);
  const disclosure = screen.getByRole("button", { name: "Advanced" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByLabelText("Stage 1")).toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  const stage = screen.getByLabelText<HTMLSelectElement>("Stage 1");
  expect(stage.value).toBe("9");
  expect([...stage.options].map((option) => option.value)).toStrictEqual([
    "9",
    "1",
    "2",
    "3",
  ]);
});

/** Submits the form and returns the authoring the one draft it sent carries. */
async function submittedAuthoring(held: {
  readonly sent: readonly Sent[];
}): Promise<unknown> {
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  const body = drafts(held.sent)[0]?.body;
  return body !== null && typeof body === "object" && "authoring" in body
    ? body.authoring
    : undefined;
}

/**
 * The picker mints its own evaluator keys and holds every stage's key to its
 * position, so a two-stage pick sends `{key, evaluators}` rather than a width.
 */
test("a two-stage pick sends positional stage keys and evaluators keyed 1..n", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  typeIntent("ship it");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(screen.getByText("Add stage"));
  fireEvent.change(screen.getByLabelText("Stage 2"), {
    target: { value: "3" },
  });
  const authoring = await submittedAuthoring(held);
  expect(authoring).toStrictEqual({
    dependencies: [],
    program: [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }, { key: 2 }, { key: 3 }] },
    ],
  });
});

/** A stage added and left alone is keyed to its place like any other. */
test("adding a stage without touching its count sends it keyed to its position", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  typeIntent("ship it");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(screen.getByText("Add stage"));
  const authoring = await submittedAuthoring(held);
  expect(authoring).toStrictEqual({
    dependencies: [],
    program: [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }] },
    ],
  });
});

/** Removing a stage moves the ones after it up, and their keys move with them. */
test("removing the first stage sends the remaining stage keyed to its new position", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  typeIntent("ship it");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(screen.getByText("Add stage"));
  fireEvent.change(screen.getByLabelText("Stage 2"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getAllByText("Remove")[0] as HTMLElement);
  const authoring = await submittedAuthoring(held);
  expect(authoring).toStrictEqual({
    dependencies: [],
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  });
});

test("the checks editor is drawn only where the configuration commands a stage for them", async () => {
  const commanding = { ...creationInitialization, commandedCheckStage: 1 };
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], commanding);
  typeIntent("ship it");
  fireEvent.click(screen.getByText("Add check"));
  fireEvent.change(screen.getByPlaceholderText("a command line"), {
    target: { value: "npm test" },
  });
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  const body = drafts(held.sent)[0]?.body;
  expect(
    body !== null && typeof body === "object" && "brief" in body
      ? (body.brief as { readonly checks?: readonly string[] }).checks
      : undefined,
  ).toStrictEqual(["npm test"]);
});

test("a configuration commanding no check stage offers no checks editor", () => {
  draw(api({ state: "Succeeded" }).ports, []);
  expect(screen.queryByText("Add check")).toBeNull();
});

/** The served policy refuses `style-src` but `'self'`, so nothing this form
 * draws — a primitive included — may append one. */
test("nothing the form draws is a runtime style element", () => {
  draw(api({ state: "Succeeded" }).ports, []);
  expect(document.querySelectorAll("style").length).toBe(0);
  fireEvent.click(screen.getByText("Advanced"));
  expect(document.querySelectorAll("style").length).toBe(0);
});

/**
 * The add control is what stops a form assembling a body the wire refuses, so
 * the row it disables at is the bound itself and not one either side of it.
 */
test("each list editor stops adding rows exactly at the bound the wire states", () => {
  const commanding = { ...creationInitialization, commandedCheckStage: 1 };
  draw(api({ state: "Succeeded" }).ports, [], commanding);
  for (const [control, bound] of [
    ["Add link", briefLinksMax],
    ["Add check", briefChecksMax],
  ] as const) {
    const add = screen.getByText<HTMLButtonElement>(control);
    for (let added = 0; added < bound; added += 1) {
      expect(add.disabled).toBe(false);
      fireEvent.click(add);
    }
    expect(add.disabled).toBe(true);
  }
});

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";
const fabric = "https://forge.test/kasofsk/chuggy-fabric";

function picker(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Repository/u });
}

function briefOf(sent: readonly Sent[]): Record<string, unknown> | undefined {
  const body = drafts(sent)[0]?.body;
  if (body === null || typeof body !== "object" || !("brief" in body))
    return undefined;
  return body.brief as Record<string, unknown>;
}

/** A project that binds nothing is every project until an operator connects
 * one, so the field is absent rather than empty and the body says nothing. */
test("a project binding nothing is neither asked for a repository nor sends one", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  expect(picker()).toBeNull();
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)).not.toHaveProperty("repository");
});

/**
 * A retired binding is one the authority refuses a brief against, so a project
 * whose only binding is retired is drawn as a project that binds nothing: the
 * field is absent rather than seeded with a repository the release would be
 * refused for, and the body names none.
 */
test("a project whose only binding is retired is asked for no repository", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "Push", "2026-09-14T00:00:00Z"),
  ]);
  expect(picker()).toBeNull();
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)).not.toHaveProperty("repository");
});

test("a sole binding is the choice already made, and it reaches the wire", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [creationBinding(chuggy)]);
  expect(picker()?.textContent).toContain("kasofsk/chuggy");
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)?.["repository"]).toBe(chuggy);
});

/** The picker draws a binding's short name and may clip even that, so the
 * address it stands for is what focusing it reveals. */
test("the chosen repository's whole address is what its picker reveals", async () => {
  draw(api({ state: "Succeeded" }).ports, [], creationInitialization, [
    creationBinding(chuggy),
  ]);
  const trigger = picker();
  if (trigger === null) throw new Error("no repository picker");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(chuggy);
});

/**
 * Two bindings is where the rule has teeth: nothing can be chosen for the
 * person, so a submission with none chosen must not reach the wire naming
 * whichever the project happened to bind first.
 */
test("two bindings ask, and a submission naming none sends nothing", () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy),
    creationBinding(scratch),
  ]);
  expect(picker()?.textContent).toContain("Choose");
  typeIntent("ship it");
  submit();
  expect(screen.getByText(/names which one/u)).toBeTruthy();
  expect(drafts(held.sent).length).toBe(0);
});

function landing(): HTMLElement | null {
  return screen.queryByRole("radiogroup", { name: "Landing" });
}

/** What the group draws as chosen, read by name because the label sits beside
 * the control rather than inside it. */
function landingChosen(): string | undefined {
  return ["Push", "Pull request", "Pull request, then merge", "None"].find(
    (name) =>
      screen.getByRole("radio", { name }).getAttribute("aria-checked") ===
      "true",
  );
}

async function chooseRepository(name: string): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Repository/u }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitemradio", { name }));
  await waitFor(() => {
    expect(picker()?.textContent).toContain(name);
  });
}

test("a form landing on None still asks for a landing, and asks for no target", () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "None"),
  ]);
  expect(landing()).toBeTruthy();
  expect(landingChosen()).toBe("None");
  expect(screen.queryByPlaceholderText("the branch to land on")).toBeNull();
});

test("a managed form asks for its landing, preselected from the repository", () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "PullRequest"),
  ]);
  expect(landing()).toBeTruthy();
  expect(landingChosen()).toBe("Pull request");
});

/**
 * A LANDING THE READER CHOSE IS NOT RE-SEEDED. The second repository's default
 * takes an untouched field, because a reader who never looked at it wants the
 * repository's answer; a reader who moved it has already given their own.
 */
test("changing repositories re-seeds an untouched landing and leaves a touched one", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "Push"),
    creationBinding(scratch, "PullRequest"),
    creationBinding(fabric, "PullRequest"),
  ]);
  expect(landingChosen()).toBe("Push");
  await chooseRepository("gdoteof/scratch");
  expect(landingChosen()).toBe("Pull request");
  fireEvent.click(screen.getByRole("radio", { name: "Push" }));
  await chooseRepository("kasofsk/chuggy-fabric");
  expect(landingChosen()).toBe("Push");
});

test("the landing reaches the wire, with the target only where one is typed", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "Push"),
  ]);
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)?.["finalization"]).toStrictEqual({ mode: "Push" });
});

test("a pull request without a branch is refused before the wire sees it", () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "PullRequest"),
  ]);
  typeIntent("ship it");
  submit();
  expect(screen.getByText(/opened from a branch of its own/u)).toBeTruthy();
  expect(drafts(held.sent).length).toBe(0);
});

test("a pull request without a target reaches the wire, into the default branch", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "PullRequest"),
  ]);
  typeIntent("ship it");
  fireEvent.change(screen.getByPlaceholderText("the branch name"), {
    target: { value: "topic/one" },
  });
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)?.["finalization"]).toStrictEqual({
    mode: "PullRequest",
  });
});

/**
 * The target is typed under a landing that draws it and the landing then
 * changed to None, which leaves a value in a box the form no longer draws.
 * The submission must still go out — a form stopped by a fault nobody can see
 * is a form nobody can fix.
 */
test("changing the landing to None releases a ticket the target box would have refused", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], creationInitialization, [
    creationBinding(chuggy, "Push"),
  ]);
  fireEvent.change(screen.getByPlaceholderText("the branch to land on"), {
    target: { value: "refs/heads/release/next" },
  });
  typeIntent("ship it");
  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(briefOf(held.sent)?.["finalization"]).toStrictEqual({ mode: "None" });
});

/** What one repository's newest commit declares, in name order: the first
 * takes check lines, and the second is fenced at a sequence of its own and
 * defaults a program of its own. */
const development = creationOffer(
  creationDeclared("n-development", chuggy, "development"),
  { commandedCheckStage: 1 },
);
const sonnet = creationOffer(
  creationDeclared("n-sonnet", chuggy, "development-sonnet"),
  {
    fence: { projectSequence: 77, configurationDigest: "b".repeat(64) },
    defaults: { dependencies: [], program: [creationStageOf(2, 1)] },
  },
);
const several = {
  offers: [development, sonnet],
  partial: false,
  repositories: [],
};

/** The project's own bootstrap, offered by its revision and listed nowhere. */
const bootstrap: CreationOffer = {
  ...creationOffer(creationSummary(bootstrapConfigurationName, "Ready")),
  listed: undefined,
};

/** A project one of whose repositories declares and the other does not. */
const mixed = {
  offers: [bootstrap, development],
  partial: false,
  repositories: [
    creationListed(creationBinding(chuggy), "Imported"),
    creationListed(creationBinding(scratch), "Bootstrapped"),
  ],
};

test("the line saying what a bootstrap's ticket is for follows the configuration chosen", async () => {
  const line = "First ticket · writes this repository's configuration";
  drawOffered(api({ state: "Succeeded" }).ports, [], mixed);
  expect(screen.queryByText(line)).toBeNull();
  await chooseConfiguration("development");
  expect(screen.queryByText(line)).toBeNull();
  await chooseConfiguration(bootstrapConfigurationName);
  expect(screen.getByText(line)).toBeDefined();
});

/**
 * Which repository a configuration may be released against is judged at the
 * release, so a refusal is the first a reader hears of a pairing the project
 * will not run, and choosing another configuration is how they answer it.
 */
test("a configuration chosen after a refused release is what the held draft is revised to, and released under", async () => {
  const held = answeringApi(
    ticketDoorAnswers(ticketDoor(), ticketRefusedFirst),
  );
  const created: number[] = [];
  drawOffered(held.ports, created, mixed);
  typeIntent("ship it");
  await chooseConfiguration("development");
  await chooseRepository("gdoteof/scratch");
  submit();
  await screen.findByText(/was created and not released/u);
  await chooseConfiguration(bootstrapConfigurationName);
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(drafts(held.sent).length).toBe(1);
  expect(revisions(held.sent)).toMatchObject([
    {
      expectedVersion: creationDraft.authoringVersion,
      configurationRevision: bootstrapConfigurationName,
      brief: { intent: "ship it", repository: scratch },
    },
  ]);
  expect(releases(held.sent).at(-1)?.body).toMatchObject({
    mutation: {
      mutation: "ReleaseDraft",
      ticket: creationDraft.ticket,
      authoringVersion: creationDraft.authoringVersion + 1,
      configurationRevision: bootstrapConfigurationName,
    },
  });
  const [first, second] = operations(held.sent);
  expect(second).not.toBe(first);
});

/**
 * Several offers is where the rule has teeth: the first ready row of this
 * project's listing is the name sorting last, and a form that took it pinned
 * every ticket to it without saying it had chosen anything.
 */
test("several configurations ask, and a submission naming none sends nothing", () => {
  const held = api({ state: "Succeeded" });
  drawOffered(held.ports, [], several);
  expect(configurationPicker().textContent).toContain("Choose");
  expect(screen.queryByText(/^Configuration ·/u)).toBeNull();
  expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
  typeIntent("ship it");
  submit();
  expect(screen.getByText(creationFaultSentence("configuration"))).toBeTruthy();
  expect(drafts(held.sent).length).toBe(0);
});

test("a chosen configuration pins and fences the ticket, and what was typed is kept", async () => {
  const held = api({ state: "Succeeded" });
  drawOffered(held.ports, [], several);
  typeTitle("Ship it");
  typeIntent("ship it");
  await chooseConfiguration("development-sonnet");
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Ship it");
  fireEvent.focus(configurationPicker());
  expect((await screen.findByRole("tooltip")).textContent).toBe("n-sonnet");
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  expect(drafts(held.sent)[0]?.body).toMatchObject({
    configurationRevision: "n-sonnet",
    configurationDigest: "b".repeat(64),
    expectedProjectSequence: 77,
    authoring: sonnet.initialization.defaults,
    brief: { title: "Ship it", intent: "ship it" },
  });
});

test("what a configuration decides for the form follows the one chosen", async () => {
  drawOffered(api({ state: "Succeeded" }).ports, [], several);
  expect(screen.queryByText("Add check")).toBeNull();
  await chooseConfiguration("development");
  expect(screen.getByText("Add check")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
  await chooseConfiguration("development-sonnet");
  expect(screen.queryByText("Add check")).toBeNull();
});

test("the next new ticket here starts on the configuration chosen last, while it is offered", async () => {
  const ports = api({ state: "Succeeded" }).ports;
  drawOffered(ports, [], several);
  await chooseConfiguration("development-sonnet");
  cleanup();

  drawOffered(ports, [], several);
  expect(configurationPicker().textContent).toContain("development-sonnet");
  cleanup();

  const basic = creationOffer(creationDeclared("n-basic", chuggy, "basic"));
  drawOffered(ports, [], { ...several, offers: [basic, development] });
  expect(configurationPicker().textContent).toContain("Choose");
});

/**
 * The remembered choice is where a form starts. One made in another tab while
 * this form is open was not made on it, so the next read of the project
 * leaves this form on what its reader saw it open on.
 */
test("a form stays on the configuration it opened on when another is chosen elsewhere", async () => {
  const ports = api({ state: "Succeeded" }).ports;
  drawOffered(ports, [], several);
  await chooseConfiguration("development-sonnet");
  cleanup();

  const drawn = drawOffered(ports, [], several);
  ticketConfigurationKept(creationPartition, "development");
  drawn.rerender({ ...several });
  expect(configurationPicker().textContent).toContain("development-sonnet");
});

test("a browser that keeps nothing is asked every time, and still creates", async () => {
  const refused = (): never => {
    throw new Error("storage is refused");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(refused);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(refused);
  const held = api({ state: "Succeeded" });
  const created: number[] = [];
  drawOffered(held.ports, created, several);
  expect(configurationPicker().textContent).toContain("Choose");
  await chooseConfiguration("development");
  typeIntent("ship it");
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(drafts(held.sent)[0]?.body).toMatchObject({
    configurationRevision: "n-development",
  });
});

/** The key is the project's, so a choice made in one says nothing of a
 * project beside it or of its namesake under another tenant. */
test("a choice is remembered for its own project and no other", async () => {
  const ports = api({ state: "Succeeded" }).ports;
  drawOffered(ports, [], several);
  await chooseConfiguration("development-sonnet");
  cleanup();

  drawOffered(ports, [], several, {
    ...creationPartition,
    project: "borealis",
  });
  expect(configurationPicker().textContent).toContain("Choose");
  cleanup();

  drawOffered(ports, [], several, { ...creationPartition, tenant: "apex" });
  expect(configurationPicker().textContent).toContain("Choose");
});

/**
 * A read that may have missed an offer cannot say the one it found is the
 * only one, so that one is asked about like any other and never taken.
 */
test("one configuration under a read that may have missed others is asked, not taken", () => {
  const held = api({ state: "Succeeded" });
  drawOffered(held.ports, [], {
    offers: [development],
    partial: true,
    repositories: [],
  });
  expect(configurationPicker().textContent).toContain("Choose");
  expect(screen.queryByText(/^Configuration ·/u)).toBeNull();
  typeIntent("ship it");
  submit();
  expect(screen.getByText(creationFaultSentence("configuration"))).toBeTruthy();
  expect(drafts(held.sent).length).toBe(0);
});

test("a walk the budget stopped says so beside what it did find", () => {
  const ports = api({ state: "Succeeded" }).ports;
  drawOffered(ports, [], several);
  expect(screen.queryByText(configurationsPartialLabel)).toBeNull();
  cleanup();
  drawOffered(ports, [], { ...several, partial: true });
  expect(screen.getByText(configurationsPartialLabel)).toBeTruthy();
});
