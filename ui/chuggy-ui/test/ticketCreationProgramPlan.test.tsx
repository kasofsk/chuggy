/**
 * The program a reader draws against the plan their configuration selects: one
 * who may not skip planned evaluations is offered no stage to remove and no
 * width narrower than its plan stage, and a program a draft already held
 * shorter than that is refused at the submit with nothing sent; one who may is
 * offered both, and sends what they drew.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";

import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { creationFormFrom } from "../app/core/ticketCreation.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import {
  creationGatedOffer,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketReleasing } from "./ticketReleasing.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const offers = [creationGatedOffer()];

/** A reader who may override and may not skip planned evaluations. */
const nonholder = { mayOverride: true, maySkipPlanned: false };

function api(): { readonly ports: ApiPorts; readonly sent: Sent[] } {
  return answeringApi(ticketReleasing);
}

function draw(
  ports: ApiPorts,
  extra: Partial<ComponentProps<typeof CreationForm>> = {},
): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        context={{ context: "Ready", offers, partial: false, repositories: [] }}
        start="Waits"
        onCreated={() => undefined}
        existing={() => null}
        {...extra}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
}

function widths(label: string): readonly string[] {
  return [...screen.getByLabelText<HTMLSelectElement>(label).options].map(
    (option) => option.value,
  );
}

function submit(): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
}

const drafted = (sent: readonly Sent[]): readonly Sent[] =>
  sent.filter((one) => one.method === "POST" && one.path.endsWith("/drafts"));

test("a reader who may not skip planned evaluations is offered no Remove and no width narrower than the plan", () => {
  draw(api().ports, { standing: nonholder });
  expect(widths("Stage 1")).toStrictEqual(["2", "3"]);
  expect(widths("Stage 2")).toStrictEqual(["1", "2", "3"]);
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
});

test("a reader who may skip planned evaluations is offered every width and a Remove on each stage, and sends the shorter program", async () => {
  const held = api();
  draw(held.ports, { standing: { mayOverride: true, maySkipPlanned: true } });
  expect(widths("Stage 1")).toStrictEqual(["1", "2", "3"]);
  expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Remove" })[1] as HTMLElement,
  );
  submit();
  await waitFor(() => {
    expect(drafted(held.sent)).toHaveLength(1);
  });
  expect(
    (drafted(held.sent)[0]?.body as { readonly authoring: unknown }).authoring,
  ).toStrictEqual({
    dependencies: [],
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  });
});

test("a short program seeded from a draft that held one is refused at the submit for a reader who may not skip it, and nothing is sent", async () => {
  const held = api();
  const whole = creationFormFrom(offers, []);
  const form = { ...whole, program: whole.program.slice(0, 1) };
  const dropped = {
    repository: undefined,
    dependencies: [],
    configuration: undefined,
  };
  draw(held.ports, {
    standing: nonholder,
    duplicate: { from: 1, seed: { form, dropped } },
  });
  submit();
  expect(
    await screen.findByText(/may not leave out part of the plan/u),
  ).toBeDefined();
  expect(held.sent.some((one) => one.method === "POST")).toBe(false);
});
