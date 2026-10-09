/**
 * The copy a browser keeps of a duplicate's YAML: under a key of its own, per
 * the ticket it started from, so a new ticket's kept copy and the images kept
 * beside it survive a duplicate opened, typed into and sent, and the plain new
 * ticket still opens on them.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import {
  ticketYamlDuplicateStoreKey,
  ticketYamlImagesKept,
  ticketYamlImagesStored,
  ticketYamlStoreKey,
} from "../app/browser/editor/authoringGuards.tsx";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { CreationDuplicate } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { ticketDuplicateSeed } from "../app/core/ticketDuplicate.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { openedStream, ScreenHarness } from "./screenHarness.tsx";
import {
  creationDraft,
  creationOffers,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { ticketReleasing } from "./ticketReleasing.tsx";

vi.mock(
  "../app/browser/editor/TicketEditor.tsx",
  () => import("./ticketReleasing.tsx"),
);

const newKey = ticketYamlStoreKey(creationPartition, undefined);
const duplicateKey = ticketYamlDuplicateStoreKey(creationPartition, 11);
const keptText = "intent: kept from a new ticket\n";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const original: DraftResponse = {
  ...creationDraft,
  ticket: 11,
  brief: {
    title: "Ship it",
    intent: "ship the thing",
    links: [],
    images: ["artifact-9"],
    finalization: { mode: "Push" },
  },
};

const duplicate: CreationDuplicate = {
  from: 11,
  seed: ticketDuplicateSeed({
    draft: original,
    offers: creationOffers,
    bound: [],
    revoked: [],
    preferred: undefined,
    partial: false,
  }),
};

function draw(ports: ApiPorts, created: number[], from?: CreationDuplicate) {
  render(
    <ScreenHarness
      partition={creationPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <CreationForm
        ports={ports}
        partition={creationPartition}
        queryKey={creationContextList(creationPartition).key}
        context={{
          context: "Ready",
          offers: creationOffers,
          partial: false,
          repositories: [],
        }}
        dispatches={false}
        onCreated={(ticket) => created.push(ticket)}
        existing={(ticket) => <a href="/there">Ticket {ticket}</a>}
        {...(from === undefined ? {} : { duplicate: from })}
      />
    </ScreenHarness>,
  );
}

function yamlBox(): Promise<HTMLTextAreaElement> {
  return screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ticket YAML",
  });
}

test("a duplicate's key is its own, apart from a new ticket's and the original's edit", () => {
  expect(duplicateKey).not.toBe(newKey);
  expect(duplicateKey).not.toBe(ticketYamlStoreKey(creationPartition, 11));
  expect(duplicateKey).not.toBe(
    ticketYamlDuplicateStoreKey(creationPartition, 12),
  );
});

test("a new ticket's kept copy is there, unchanged, after a duplicate is opened, typed and sent", async () => {
  window.localStorage.setItem(newKey, keptText);
  ticketYamlImagesKept(newKey, ["artifact-1"]);
  const created: number[] = [];
  const held = answeringApi(ticketReleasing);
  draw(held.ports, created, duplicate);

  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Ship it");
  fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  const editor = await yamlBox();
  expect(editor.value).toContain("title: Ship it");
  expect(editor.value).toContain("artifact-9");
  fireEvent.change(editor, {
    target: { value: editor.value.replace("ship the thing", "ship it again") },
  });
  expect(window.localStorage.getItem(duplicateKey)).toContain("ship it again");
  expect(window.localStorage.getItem(newKey)).toBe(keptText);

  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  const asked = await screen.findByRole("dialog");
  fireEvent.click(within(asked).getByRole("button", { name: "Create ticket" }));
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(
    held.sent.find((one) => one.path.endsWith("/drafts"))?.body,
  ).toMatchObject({
    brief: { intent: "ship it again", images: ["artifact-9"] },
  });
  expect(window.localStorage.getItem(duplicateKey)).toBeNull();
  expect(window.localStorage.getItem(newKey)).toBe(keptText);
  expect(ticketYamlImagesStored(newKey)).toStrictEqual(["artifact-1"]);
  cleanup();

  draw(answeringApi(ticketReleasing).ports, []);
  expect((await yamlBox()).value).toBe(keptText);
});

test("a duplicate opens on its own kept copy, and not on a new ticket's", async () => {
  window.localStorage.setItem(newKey, keptText);
  window.localStorage.setItem(duplicateKey, "intent: the duplicate's own\n");
  draw(answeringApi(ticketReleasing).ports, [], duplicate);
  expect((await yamlBox()).value).toBe("intent: the duplicate's own\n");
});
