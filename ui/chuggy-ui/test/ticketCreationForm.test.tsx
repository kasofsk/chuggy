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
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import {
  creationDraft,
  creationInitialization,
  creationPartition,
} from "./ticketCreationFixture.ts";

/** The runner has no globals, so each case tears down the tree it rendered. */
afterEach(cleanup);

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
  tickets: [{ ticket: creationDraft.ticket, phase: "Pending", sequence: 42 }],
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
          },
          initialization: next,
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
test("the shaping sentence keeps the revision behind the name it draws", () => {
  const held = api({ state: "Succeeded" });
  draw(held.ports, []);
  const sentence = screen.getByText(/^shaped by configuration chuggy #12,/u);
  expect(sentence.getAttribute("title")).toBe(
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
  typeIntent("ship it");
  fireEvent.change(screen.getByPlaceholderText("the branch name"), {
    target: { value: "topic/one" },
  });
  drawn.rerender({
    ...creationInitialization,
    fence: { ...creationInitialization.fence, projectSequence: 99 },
  });
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
    defaults: { ...creationInitialization.defaults, workFanout: 9 },
  };
  draw(api({ state: "Succeeded" }).ports, [], chosen);
  const disclosure = screen.getByText("advanced").closest("details");
  expect(disclosure).not.toBeNull();
  const fanout = screen.getByLabelText<HTMLSelectElement>("work fanout");
  expect(fanout.value).toBe("9");
  expect([...fanout.options].map((option) => option.value)).toStrictEqual([
    "9",
    "1",
    "2",
  ]);
});
