/**
 * The creation form's one press, for a reader who may dispatch, for one who
 * may not, and in a project whose work has no runner to go to: the line under
 * the button and the way to a runner after it, the release and the dispatch
 * it drives with the button busy throughout, what the note under it reads
 * while each is followed, and the ticket it hands its caller to navigate to
 * whatever the dispatch met.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import type { CreationStart } from "../app/core/ticketCreation.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  creationDraft,
  creationOffers,
  creationPartition,
} from "./ticketCreationFixture.ts";
import {
  dispatchingMutation,
  dispatchingRefusal,
  dispatchingRefused,
  dispatchingView,
  ticketDispatching,
} from "./ticketDispatching.ts";
import type { TicketDispatching } from "./ticketDispatching.ts";
import type * as RouterModule from "@tanstack/react-router";

vi.mock(
  "../app/browser/editor/TicketEditor.tsx",
  () => import("./ticketReleasing.tsx"),
);

/** A link's path is filled from its params, so a link into the wrong project
 * is a wrong href rather than the same one. */
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
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
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(cleanup);

interface Api {
  readonly ports: ApiPorts;
  readonly sent: readonly Sent[];
}

/** The form over a project offering one configuration, and the tickets it
 * handed its caller to navigate to. */
function draw(ports: ApiPorts, start: CreationStart): readonly number[] {
  const created: number[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        start={start}
        context={{
          context: "Ready",
          offers: creationOffers,
          partial: false,
          repositories: [],
        }}
        onCreated={(ticket) => created.push(ticket)}
        existing={() => null}
      />
    </QueryClientProvider>,
  );
  return created;
}

function button(): HTMLElement {
  return screen.getByRole("button", { name: "Create ticket" });
}

/** The least a form may say, typed, and the one press. */
function pressed(): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  fireEvent.click(button());
}

function mutations(sent: readonly Sent[]): readonly string[] {
  return sent.flatMap((one) => dispatchingMutation(one) ?? []);
}

/** The identity each submission went under, in the order they were sent. */
function operations(sent: readonly Sent[]): readonly string[] {
  return sent
    .filter((one) => dispatchingMutation(one) !== undefined)
    .map((one) => (one.body as { readonly operation: string }).operation);
}

/** `api`, with the poll of the submission at `position` in the order they
 * were sent, the release first, held back until the case lets it go. */
function pollHeld(
  api: Api,
  position: number,
): {
  readonly ports: ApiPorts;
  readonly release: () => void;
} {
  let release: () => void = () => undefined;
  const letGo = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    ports: {
      ...api.ports,
      fetch: async (path, init) => {
        const held = operations(api.sent)[position];
        if (held !== undefined && path.endsWith(`/${held}`)) await letGo;
        return api.ports.fetch(path, init);
      },
    },
  };
}

/** What the note reads from a settled release until the form navigates, for
 * a press that goes on to dispatch. */
const starting = "starting…";

const effects: readonly (readonly [string, CreationStart, string])[] = [
  ["starts work", "Starts", "Starts work"],
  ["waits on a dispatcher", "Waits", "Released for a dispatcher to start"],
  ["has no runner to start work on", "NoRunner", "No runner"],
];

test.each(effects)(
  "Create ticket tells a reader whose press %s what it does",
  (_press, start, effect) => {
    draw(answeringApi(ticketDispatching()).ports, start);
    expect(
      screen.getByRole("button", {
        name: "Create ticket",
        description: effect,
      }),
    ).toBeDefined();
  },
);

function addRunner(): HTMLElement | null {
  return screen.queryByRole("link", { name: "Add runner" });
}

/** The link stands after the line and outside it, so the button is described
 * by the words alone and the way to a runner is a control of its own. */
test("a press with no runner to start work on draws the way to the project's Runners page after its line", () => {
  draw(answeringApi(ticketDispatching()).ports, "NoRunner");
  expect(addRunner()?.getAttribute("href")).toBe(
    `/${creationPartition.tenant}/${creationPartition.project}/runners`,
  );
  expect(addRunner()?.parentElement?.textContent).toBe(
    "No runner · Add runner",
  );
});

/** The YAML's press asks before it sends, and the ask is where its line is. */
test("the YAML's ask draws the same line and the same way to a runner", async () => {
  draw(answeringApi(ticketDispatching()).ports, "NoRunner");
  fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  await screen.findByRole("textbox", { name: "Ticket YAML" });
  expect(addRunner()).toBeNull();
  fireEvent.click(button());
  const asked = within(await screen.findByRole("dialog"));
  expect(
    asked.getByRole("link", { name: "Add runner" }).parentElement?.textContent,
  ).toBe("No runner · Add runner");
  expect(
    asked.getByRole("button", {
      name: "Create ticket",
      description: "No runner",
    }),
  ).toBeDefined();
});

test.each(["Starts", "Waits"] as const)(
  "a press that %s draws no way to a runner",
  (start) => {
    draw(answeringApi(ticketDispatching()).ports, start);
    expect(addRunner()).toBeNull();
  },
);

test("the note is the release's own until the release has settled", async () => {
  const api = answeringApi(ticketDispatching());
  const held = pollHeld(api, 0);
  const created = draw(held.ports, "Starts");
  pressed();
  await screen.findByText("waiting for the actor to decide the release…");
  expect(screen.queryByText(starting)).toBeNull();

  act(held.release);
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
});

test("one press releases and dispatches, the button busy and the note starting until the dispatch has settled", async () => {
  const api = answeringApi(ticketDispatching());
  const held = pollHeld(api, 1);
  const created = draw(held.ports, "Starts");
  pressed();
  await waitFor(() => {
    expect(mutations(api.sent)).toStrictEqual([
      "ReleaseDraft",
      "ManualDispatch",
    ]);
  });
  expect(button()).toHaveProperty("disabled", true);
  expect(screen.getByText(starting).className).toBe("panel-note");
  expect(screen.queryByText("released")).toBeNull();
  expect(created).toStrictEqual([]);

  act(held.release);
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  const [release, dispatch] = operations(api.sent);
  expect(dispatch).not.toBe(release);
});

const unstarting: readonly (readonly [string, CreationStart])[] = [
  ["of a reader who may not dispatch", "Waits"],
  ["in a project with no runner", "NoRunner"],
];

/** The ticket is made and released either way, so it is there to start once
 * somebody may and something can run it. */
test.each(unstarting)(
  "the press %s releases, reads no dispatch view, starts nothing and navigates",
  async (_press, start) => {
    const api = answeringApi(ticketDispatching());
    const created = draw(api.ports, start);
    pressed();
    await waitFor(() => {
      expect(created).toStrictEqual([creationDraft.ticket]);
    });
    expect(mutations(api.sent)).toStrictEqual(["ReleaseDraft"]);
    expect(
      api.sent.filter((one) => one.path.includes("/dispatch-view")),
    ).toStrictEqual([]);
    expect(screen.getByText("released").className).toBe("panel-note");
    expect(screen.queryByText(starting)).toBeNull();
  },
);

test("a release refused for a reader who may dispatch is drawn as a creation's, and nothing is dispatched", async () => {
  const api = answeringApi(
    ticketDispatching({ released: dispatchingRefused("ConfigurationInvalid") }),
  );
  const created = draw(api.ports, "Starts");
  pressed();
  await waitFor(() => {
    expect(document.querySelector(".panel-failed")).not.toBeNull();
  });
  expect(document.querySelector(".panel-failed")?.textContent).not.toContain(
    "the draft holds this revision",
  );
  expect(screen.queryByText(starting)).toBeNull();
  expect(mutations(api.sent)).toStrictEqual(["ReleaseDraft"]);
  expect(created).toStrictEqual([]);
});

const endings: readonly (readonly [string, TicketDispatching])[] = [
  ["is of a ticket that is no candidate", { view: dispatchingView([]) }],
  [
    "could not read the dispatch view",
    { view: dispatchingRefusal(403, "Forbidden") },
  ],
  [
    "the actor refused as changed",
    { dispatched: dispatchingRefused("TicketChanged") },
  ],
  ["the API refused", { declined: dispatchingRefusal(403, "Forbidden") }],
  [
    "the API deferred",
    { declined: dispatchingRefusal(429, "DispatchBacklog") },
  ],
  ["nobody saw settle", { dispatched: { state: "Pending" } }],
];

test.each(endings)(
  "a dispatch that %s navigates to the ticket, and the form draws no fault",
  async (_ending, said) => {
    const created = draw(answeringApi(ticketDispatching(said)).ports, "Starts");
    pressed();
    await waitFor(() => {
      expect(created).toStrictEqual([creationDraft.ticket]);
    });
    expect(document.querySelector(".panel-failed, .panel-absent")).toBeNull();
  },
);
