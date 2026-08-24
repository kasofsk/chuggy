import assert from "node:assert/strict";
import test from "node:test";

import { releaseDraftMutation } from "../../ui/app/protocol.js";
import { createTicketCreation } from "../../ui/dom/ticketCreationController.js";
import {
  ticketCreationDraft,
  ticketCreationInitialization,
  ticketCreationPartition,
} from "./ticketCreationFixture.ts";

type Partition = { readonly tenant: string; readonly project: string };

const operationsModule = "../../ui/dom/console.js";
const { createConsole } = (await import(operationsModule)) as {
  createConsole: (parts: unknown) => {
    select: (partition: Partition) => void;
    pause: () => void;
    submitMutation: (
      ticket: number,
      mutation: ReturnType<typeof releaseDraftMutation>,
    ) => Promise<
      { result: "Succeeded" } | { result: "Failed"; reason: string }
    >;
  };
};

function shellSend(requests: string[]) {
  return (request: { method: string; url: string }) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url.includes("draft-initializations"))
      return Promise.resolve({
        outcome: "Ok" as const,
        body: ticketCreationInitialization,
      });
    if (request.url.endsWith("/drafts"))
      return Promise.resolve({
        outcome: "Ok" as const,
        body: ticketCreationDraft(),
      });
    return Promise.resolve({
      outcome: "Accepted" as const,
      body: { operation: "release-8", state: "Succeeded" },
      location: "/operations/release-8",
    });
  };
}

test("the shell follows draft release before navigating to ticket detail", async () => {
  const requests: string[] = [];
  const send = shellSend(requests);
  const session = {
    accessToken: () => Promise.resolve("token"),
    signedIn: () => true,
  };
  const operations = createConsole({
    session,
    send,
    nowMs: () => 1,
    onChanged: () => undefined,
  });
  operations.select(ticketCreationPartition);
  operations.pause();
  let resolveNavigation: (ticket: number) => void = () => undefined;
  const navigated = new Promise<number>((resolve) => {
    resolveNavigation = resolve;
  });
  const creation = createTicketCreation({
    session,
    send,
    onChanged: () => undefined,
    onRelease: (event) => {
      void operations
        .submitMutation(
          event.ticket,
          releaseDraftMutation(
            event.ticket,
            event.authoringVersion,
            event.configurationRevision,
          ),
        )
        .then((result) => {
          creation.releaseAnswered(result);
        });
    },
    onNavigate: (ticket) => {
      resolveNavigation(ticket);
    },
  });
  creation.selectProject(ticketCreationPartition, [
    { revision: "ready", readiness: "Ready" },
  ]);
  await creation.selectRevision("ready");
  await creation.submit();
  creation.release();

  assert.equal(await navigated, 8);
  assert.equal(
    requests.at(-1),
    "POST /api/v1/tenants/acme/projects/atlas/operations",
  );
});
