/**
 * The creation screen typed as YAML: the switch between the two views, the
 * submit that shows what it sends first, and the copy this browser keeps.
 *
 * The editor is stood in for by a text area, because what is checked here is
 * the screen around it.
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

import { ticketYamlStoreKey } from "../app/browser/editor/authoringGuards.tsx";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  creationDraft,
  creationInitialization,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { ticketReleasing } from "./ticketReleasing.tsx";

vi.mock(
  "../app/browser/editor/TicketEditor.tsx",
  () => import("./ticketReleasing.tsx"),
);

const storeKey = ticketYamlStoreKey(creationPartition, undefined);

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function api(): { readonly ports: ApiPorts; readonly sent: Sent[] } {
  return answeringApi(ticketReleasing);
}

function draw(ports: ApiPorts, created: number[] = []): boolean[] {
  const dirty: boolean[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        context={{
          context: "Ready",
          configuration: creationSummary("r3", "Ready"),
          initialization: creationInitialization,
          repositories: [],
        }}
        onCreated={(ticket) => created.push(ticket)}
        onDirty={(held) => dirty.push(held)}
      />
    </QueryClientProvider>,
  );
  return dirty;
}

async function toYaml(): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  return screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
}

function type(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: text } });
}

test("the YAML starts as the form reads, and reads back into it", async () => {
  draw(api().ports);
  fireEvent.change(screen.getByPlaceholderText("what this ticket is called"), {
    target: { value: "Ship it" },
  });
  const editor = await toYaml();
  expect(editor.value).toContain("title: Ship it\n");
  type(editor, editor.value.replace("Ship it", "Shipped"));
  fireEvent.click(screen.getByRole("radio", { name: "Form" }));
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Shipped");
});

test("text that reads as no form holds the screen on the YAML", async () => {
  const dirty = draw(api().ports);
  const editor = await toYaml();
  type(editor, "title: [unclosed\n");
  await screen.findByText("fix the YAML to switch back to the form");
  fireEvent.click(screen.getByRole("radio", { name: "Form" }));
  expect(screen.getByRole("textbox", { name: "Ticket YAML" })).toBeDefined();
  expect(screen.getByRole("list", { name: "Problems" }).textContent).toMatch(
    /^line \d+: /u,
  );
  expect(dirty.at(-1)).toBe(true);
});

/** The submit shows the text it will send and how many problems stand in its
 * way, and sends nothing while any do. */
test("the submit asks first, and refuses while a problem stands", async () => {
  const held = api();
  const created: number[] = [];
  draw(held.ports, created);
  const editor = await toYaml();
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  const asked = await screen.findByRole("dialog");
  expect(asked.textContent).toMatch(/One problem must be fixed/u);
  const confirm = within(asked).getByRole("button", {
    name: "Create ticket",
    description: "Releases the ticket to run",
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(asked).getByRole("button", { name: "Close" }));

  type(editor, editor.value.replace('intent: ""', "intent: ship it"));
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  const again = await screen.findByRole("dialog");
  expect(again.textContent).toContain("intent: ship it");
  expect(again.textContent).toMatch(/Nothing is wrong/u);
  fireEvent.click(within(again).getByRole("button", { name: "Create ticket" }));
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(window.localStorage.getItem(storeKey)).toBeNull();
  expect(
    held.sent.some(
      (one) =>
        one.path.endsWith("/drafts") &&
        JSON.stringify(one.body).includes('"intent":"ship it"'),
    ),
  ).toBe(true);
});

test("what was typed is kept, and the screen reopens on it", async () => {
  draw(api().ports);
  const editor = await toYaml();
  type(editor, "intent: kept\n");
  expect(window.localStorage.getItem(storeKey)).toBe("intent: kept\n");
  cleanup();

  draw(api().ports);
  const reopened = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
  expect(reopened.value).toBe("intent: kept\n");
  fireEvent.click(screen.getByRole("button", { name: "Discard it" }));
  expect(window.localStorage.getItem(storeKey)).toBeNull();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ticket YAML" })
      .value,
  ).toContain('intent: ""');
});

test("switching back to the form forgets the kept copy", async () => {
  draw(api().ports);
  const editor = await toYaml();
  type(editor, "intent: kept\n");
  fireEvent.click(screen.getByRole("radio", { name: "Form" }));
  expect(window.localStorage.getItem(storeKey)).toBeNull();
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("kept");
});
