/**
 * The creation form's one press, for a reader who may dispatch and for one
 * who may not: the line under the button, the release and the dispatch it
 * drives with the button busy throughout, and the ticket it hands its caller
 * to navigate to whatever the dispatch met.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
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
function draw(ports: ApiPorts, dispatches: boolean): readonly number[] {
  const created: number[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        dispatches={dispatches}
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

/** `api`, with the poll of its dispatch held back until the case lets it go. */
function dispatchHeld(api: Api): {
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
        const dispatch = operations(api.sent)[1];
        if (dispatch !== undefined && path.endsWith(`/${dispatch}`))
          await letGo;
        return api.ports.fetch(path, init);
      },
    },
  };
}

test.each([
  ["may dispatch", true, "Starts work"],
  ["may not dispatch", false, "Released for a dispatcher to start"],
])(
  "Create ticket tells a reader who %s what the press does",
  (_reader, dispatches, effect) => {
    draw(answeringApi(ticketDispatching()).ports, dispatches);
    expect(
      screen.getByRole("button", {
        name: "Create ticket",
        description: effect,
      }),
    ).toBeDefined();
  },
);

test("one press releases and dispatches, the button busy until the dispatch has settled", async () => {
  const api = answeringApi(ticketDispatching());
  const held = dispatchHeld(api);
  const created = draw(held.ports, true);
  pressed();
  await waitFor(() => {
    expect(mutations(api.sent)).toStrictEqual([
      "ReleaseDraft",
      "ManualDispatch",
    ]);
  });
  expect(button()).toHaveProperty("disabled", true);
  expect(created).toStrictEqual([]);

  act(held.release);
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  const [release, dispatch] = operations(api.sent);
  expect(dispatch).not.toBe(release);
});

test("the press of a reader who may not dispatch releases, reads no dispatch view and navigates", async () => {
  const api = answeringApi(ticketDispatching());
  const created = draw(api.ports, false);
  pressed();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(mutations(api.sent)).toStrictEqual(["ReleaseDraft"]);
  expect(
    api.sent.filter((one) => one.path.includes("/dispatch-view")),
  ).toStrictEqual([]);
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
  ["nobody saw settle", { dispatched: { state: "Pending" } }],
];

test.each(endings)(
  "a dispatch that %s navigates to the ticket, and the form draws no fault",
  async (_ending, said) => {
    const created = draw(answeringApi(ticketDispatching(said)).ports, true);
    pressed();
    await waitFor(() => {
      expect(created).toStrictEqual([creationDraft.ticket]);
    });
    expect(document.querySelector(".panel-failed, .panel-absent")).toBeNull();
  },
);
