/**
 * The form's Overrides as a person drives them: drawn once a configuration is
 * chosen, a model typed sent as the mode with that one thing changed, a field
 * given back sending nothing, and what was overridden kept across a change of
 * configuration.
 *
 * The documents offered are this repository's own declarations, one naming
 * its model as an argument and one naming none.
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

import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import type { CreationOffer } from "../app/core/ticketCreation.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import { chooseConfiguration } from "./creationPicker.ts";
import type { Sent } from "./answeringApi.ts";
import {
  creationDeclared,
  creationDraft,
  creationOffer,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const declarations = import.meta.glob<string>(
  "../../../.chug/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);

function canonicalOf(name: string): string {
  const raw = declarations[`../../../.chug/configurations/${name}.json`];
  if (raw === undefined) throw new Error(`no ${name} configuration declared`);
  return JSON.stringify(
    (JSON.parse(raw) as { readonly configuration: unknown }).configuration,
  );
}

const chuggy = "https://forge.test/kasofsk/chuggy";

function offerOf(
  revision: string,
  name: string,
  declared: string,
): CreationOffer {
  const offer = creationOffer(creationDeclared(revision, chuggy, name));
  return {
    ...offer,
    initialization: {
      ...offer.initialization,
      configuration: {
        ...offer.initialization.configuration,
        canonical: canonicalOf(declared),
      },
    },
  };
}

const sonnet = offerOf(
  "n-sonnet",
  "development-sonnet",
  "chuggy-development-sonnet",
);
const basic = offerOf("n-basic", "basic", "basic-coding");
const tools = "--allowedTools=Bash,Edit,Read,Write,Glob,Grep";

function api(): { readonly ports: ApiPorts; readonly sent: Sent[] } {
  return answeringApi((method, path) => {
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: creationDraft };
    if (method === "POST" && path.endsWith("/operations"))
      return { status: 202, body: { operation: "op", state: "Pending" } };
    return { status: 200, body: {} };
  });
}

function draw(ports: ApiPorts): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        context={{
          context: "Ready",
          offers: [basic, sonnet],
          partial: false,
          repositories: [],
        }}
        onCreated={() => undefined}
        existing={() => null}
      />
    </QueryClientProvider>,
  );
}

function model(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name: /^Model/u });
}

function typeModel(text: string): void {
  fireEvent.change(model(), { target: { value: text } });
}

/** What the one draft a submit created was sent with, by key. */
async function submitted(
  sent: readonly Sent[],
): Promise<Readonly<Record<string, unknown>>> {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await waitFor(() => {
    expect(
      sent.some((one) => one.method === "POST" && one.path.endsWith("/drafts")),
    ).toBe(true);
  });
  const draft = sent.find(
    (one) => one.method === "POST" && one.path.endsWith("/drafts"),
  );
  return draft?.body as Readonly<Record<string, unknown>>;
}

test("the overrides are a disclosure of their own, drawn closed and only once a configuration is chosen", async () => {
  draw(api().ports);
  expect(screen.queryByRole("button", { name: "Overrides" })).toBeNull();
  await chooseConfiguration("development-sonnet");
  const disclosure = screen.getByRole("button", { name: "Overrides" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(disclosure);
  expect(model().placeholder).toBe("sonnet");
  expect(model().value).toBe("");
  expect(screen.getByText("npm ci")).toBeDefined();
});

test.each([
  [
    "names its model as an argument",
    "development-sonnet",
    [tools, "--model=opus"],
  ],
  ["names no model", "basic", [tools, "--model=opus"]],
])(
  "a model typed under a mode that %s is released as that mode with the model alone changed",
  async (_said, name, args) => {
    const held = api();
    draw(held.ports);
    await chooseConfiguration(name);
    fireEvent.click(screen.getByRole("button", { name: "Overrides" }));
    typeModel("opus");
    expect((await submitted(held.sent))["overrides"]).toStrictEqual({
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: args },
      },
    });
  },
);

test("the configuration's own model typed is kept in the box and sends no override", async () => {
  const held = api();
  draw(held.ports);
  await chooseConfiguration("development-sonnet");
  fireEvent.click(screen.getByRole("button", { name: "Overrides" }));
  typeModel("sonnet");
  expect(model().value).toBe("sonnet");
  expect("overrides" in (await submitted(held.sent))).toBe(false);
});

test("a field overridden and given back sends no override for it", async () => {
  const held = api();
  draw(held.ports);
  await chooseConfiguration("development-sonnet");
  fireEvent.click(screen.getByRole("button", { name: "Overrides" }));
  fireEvent.click(screen.getByRole("button", { name: "Override setup" }));
  const setup = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Setup",
  });
  expect(setup.value).toBe("npm ci");
  fireEvent.change(setup, { target: { value: "npm ci\nmake" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Use the configuration's" }),
  );
  expect(screen.queryByRole("textbox", { name: "Setup" })).toBeNull();
  expect("overrides" in (await submitted(held.sent))).toBe(false);
});

test("choosing another configuration keeps what was overridden, and draws the rest from the new one", async () => {
  const held = api();
  draw(held.ports);
  await chooseConfiguration("development-sonnet");
  fireEvent.click(screen.getByRole("button", { name: "Overrides" }));
  fireEvent.click(screen.getByRole("button", { name: "Override setup" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Setup" }), {
    target: { value: "make" },
  });
  typeModel("opus");
  await chooseConfiguration("basic");
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Setup" }).value,
  ).toBe("make");
  expect(model().value).toBe("opus");
  expect(model().placeholder).toBe("");
  const body = await submitted(held.sent);
  expect(body["configurationRevision"]).toBe("n-basic");
  expect(body["overrides"]).toMatchObject({ worker: { setup: ["make"] } });
});
