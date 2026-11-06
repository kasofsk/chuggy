/**
 * A project thread's press saves the draft a form beside it holds edits of
 * before it sends, and sends nothing, keeping what was typed, where that save
 * is refused. A member's own chat asks for no save.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import {
  DraftSaveHeld,
  useDraftSaveOffered,
} from "../app/browser/editor/draftSaveBeforeSend.tsx";
import {
  useMemberThreadSend,
  useThreadSend,
} from "../app/browser/thread/threadSend.tsx";
import { useApiPorts } from "../app/browser/api.ts";
import type { ConversationSent } from "../app/browser/conversation/Conversation.tsx";
import { answer } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { creationDraft } from "./ticketCreationFixture.ts";
import { threadPartition } from "./threadFixture.ts";
import { threadSendWrapped } from "./threadSendWrapped.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every write the page sent, as its method and the end of its address, in
 * the order it sent them; a revision is answered as the draft refuses or
 * takes it. */
function writesServed(revision: "Taken" | "Refused"): string[] {
  const writes: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        answer(sessionPlacementBody({ thread: "InCluster" })),
      );
    if (method === "GET")
      return Promise.resolve(new Response(null, { status: 404 }));
    writes.push(`${method} ${url.slice(url.lastIndexOf("/"))}`);
    if (method === "PUT")
      return Promise.resolve(
        revision === "Taken"
          ? answer({ ...creationDraft, authoringVersion: 4 })
          : answer({ error: { code: "DraftChanged" } }, 409),
      );
    return Promise.resolve(answer({ turn: "t", ordinal: 1 }, 202));
  });
  return writes;
}

/** A form holding edits of draft 12, beside the composer the hook makes. */
function FormBeside(): null {
  useDraftSaveOffered({
    ports: useApiPorts(),
    partition: threadPartition,
    ticket: 12,
    offered: true,
    assemble: () => ({
      assembled: "Body",
      revision: {
        expectedVersion: 3,
        configurationRevision: "r3",
        authoring: creationDraft.authoring,
        brief: { title: "Mine", intent: "ship it", links: [] },
      },
    }),
    onFaults: () => undefined,
    onSaved: () => undefined,
  });
  return null;
}

function besideAForm(): (props: { readonly children: ReactNode }) => ReactNode {
  const Wrapped = threadSendWrapped();
  return (props) => (
    <Wrapped>
      <DraftSaveHeld>
        <FormBeside />
        {props.children}
      </DraftSaveHeld>
    </Wrapped>
  );
}

async function pressed(
  onSend: (text: string, attached: []) => Promise<ConversationSent>,
): Promise<ConversationSent> {
  let ended: ConversationSent = "Sent";
  await act(async () => {
    ended = await onSend("is it right now?", []);
  });
  return ended;
}

test("a project thread's press saves the form's draft first, then sends", async () => {
  const writes = writesServed("Taken");
  const sending = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper: besideAForm() },
  );

  expect(await pressed(sending.result.current.composer.onSend)).toBe("Sent");
  expect(writes).toStrictEqual(["PUT /12", "POST /messages"]);
});

test("a press whose save is refused sends nothing and keeps what was typed", async () => {
  const writes = writesServed("Refused");
  const sending = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper: besideAForm() },
  );

  expect(await pressed(sending.result.current.composer.onSend)).toBe("Kept");
  expect(writes).toStrictEqual(["PUT /12"]);
});

test("a member's own chat asks for no save", async () => {
  const writes = writesServed("Refused");
  const sending = renderHook(
    () =>
      useMemberThreadSend({
        tenant: threadPartition.tenant,
        session: "thread-1",
        takes: true,
      }),
    { wrapper: besideAForm() },
  );

  await pressed(sending.result.current.composer.onSend);
  expect(writes).toStrictEqual(["POST /messages"]);
});
