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
import type { ProjectRepositoryResponse } from "../../../src/contract/responses.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import {
  creationBinding,
  creationDraft,
  creationInitialization,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

/** The runner has no globals, so each case tears down the tree it rendered. */
beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

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
  const sent: Sent[] = [];
  return {
    sent,
    ports: {
      fetch: (path, init) => {
        const body: unknown =
          init.body === undefined ? undefined : JSON.parse(init.body);
        sent.push({ method: init.method, path, body });
        const answer = ((): { status: number; body: unknown } => {
          if (init.method === "POST" && path.endsWith("/drafts"))
            return {
              status: options.draftStatus ?? 201,
              body:
                (options.draftStatus ?? 201) === 201
                  ? creationDraft
                  : { error: { code: "DraftInitializationStale" } },
            };
          if (init.method === "POST" && path.endsWith("/operations"))
            return { status: 202, body: { operation: "op", state: "Pending" } };
          if (path.includes("/operations/"))
            return { status: 200, body: operationBody(options.state) };
          return { status: 200, body: projectBody };
        })();
        return Promise.resolve({
          status: answer.status,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(answer.body)),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

const queryKey = creationContextList(creationPartition).key;

function draw(
  ports: ApiPorts,
  created: number[],
  initialization = creationInitialization,
  repositories: readonly ProjectRepositoryResponse[] = [],
): { readonly rerender: (next: typeof creationInitialization) => void } {
  const tree = (next: typeof creationInitialization) => (
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={queryKey}
        context={{
          context: "Ready",
          configuration: {
            revision: next.configuration.revision,
            digest: next.configuration.digest,
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
          },
          initialization: next,
          repositories,
        }}
        onCreated={(ticket) => created.push(ticket)}
      />
    </QueryClientProvider>
  );
  const drawn = render(tree(initialization));
  return {
    rerender: (next) => {
      drawn.rerender(tree(next));
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
  fireEvent.click(screen.getByText("create and release"));
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

/** The sentence names the configuration nobody was asked about, so the revision
 * it names it instead of has nowhere else on this screen to be. */
test("the shaping sentence keeps the revision behind the name it draws", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  const sentence = screen.getByText(/^shaped by configuration chuggy #12,/u);
  fireEvent.focus(sentence);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    creationInitialization.configuration.revision,
  );
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

test("a release the actor refuses draws the reason and navigates nowhere", async () => {
  const held = api({ state: "Cancelled" });
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  submit();
  await screen.findByText(/was created and not released/u);
  expect(created).toStrictEqual([]);
});

test("a follow that runs out of budget navigates nowhere either", async () => {
  const held = api({ state: "Pending" });
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  submit();
  await screen.findByText(/attempt budget/u);
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

test("a held draft is released again, under the identity it was released under", async () => {
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
  const [first, second] = releases(held.sent).map((one) =>
    one.body !== null && typeof one.body === "object" && "operation" in one.body
      ? one.body.operation
      : undefined,
  );
  expect(first).toBe(second);
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
  expect(screen.queryByLabelText("stage 1")).toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  const stage = screen.getByLabelText<HTMLSelectElement>("stage 1");
  expect(stage.value).toBe("9");
  expect([...stage.options].map((option) => option.value)).toStrictEqual([
    "9",
    "1",
    "2",
    "3",
  ]);
});

/**
 * The picker mints its own evaluator keys and holds every stage's key to its
 * position, so a two-stage pick sends `{key, evaluators}` rather than a width.
 */
test("a two-stage pick sends positional stage keys and evaluators keyed 1..n", async () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  typeIntent("ship it");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(screen.getByText("add stage"));
  fireEvent.change(screen.getByLabelText("stage 2"), {
    target: { value: "3" },
  });
  submit();
  await waitFor(() => {
    expect(drafts(held.sent).length).toBe(1);
  });
  const body = drafts(held.sent)[0]?.body;
  const authoring =
    body !== null && typeof body === "object" && "authoring" in body
      ? body.authoring
      : undefined;
  expect(authoring).toStrictEqual({
    dependencies: [],
    program: [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }, { key: 2 }, { key: 3 }] },
    ],
  });
});

test("the checks editor is drawn only where the configuration commands a stage for them", async () => {
  const commanding = { ...creationInitialization, commandedCheckStage: 1 };
  const held = api({ state: "Succeeded" });
  draw(held.ports, [], commanding);
  typeIntent("ship it");
  fireEvent.click(screen.getByText("add check"));
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
  expect(screen.queryByText("add check")).toBeNull();
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
    ["add link", briefLinksMax],
    ["add check", briefChecksMax],
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
  return screen.queryByRole("button", { name: /^repository/u });
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
  expect(picker()?.textContent).toContain("choose");
  typeIntent("ship it");
  submit();
  expect(screen.getByText(/names which one/u)).toBeTruthy();
  expect(drafts(held.sent).length).toBe(0);
});

function landing(): HTMLElement | null {
  return screen.queryByRole("radiogroup", { name: "landing" });
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
  fireEvent.keyDown(screen.getByRole("button", { name: /^repository/u }), {
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
