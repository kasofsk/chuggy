/**
 * A message sent with images: each uploaded as the bytes pasted, then the
 * message naming what the uploads answered. A backlogged mailbox hands both
 * back and a second press reaches the same row with the same images, an edit
 * of either releases the turn, and an upload that fails sends nothing.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { threadMessageImagesMax } from "../../../src/contract/http.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { useThreadSend } from "../app/browser/thread/threadSend.tsx";
import type { ConversationAttachment } from "../app/core/conversationAttachments.ts";
import { answer, holderDouble } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { threadPartition } from "./threadFixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Posted {
  readonly url: string;
  readonly contentType: string | undefined;
  readonly body: unknown;
}

/** The door as a case scripts it: each upload and each message answered by
 * the next the case names, an upload minting `artifact-N` by default and a
 * message taken by default. */
function doorAnswering(script: {
  readonly uploads?: (() => Response)[];
  readonly messages?: (() => Response)[];
}): Posted[] {
  const posted: Posted[] = [];
  let minted = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        answer(sessionPlacementBody({ thread: "InCluster" })),
      );
    const headers = init.headers as Record<string, string>;
    posted.push({
      url,
      contentType: headers["content-type"],
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    if (url.endsWith("/artifacts")) {
      const scripted = script.uploads?.shift();
      minted += 1;
      return Promise.resolve(
        scripted?.() ??
          answer({ artifact: `artifact-${String(minted)}`, digest: "d" }, 201),
      );
    }
    return Promise.resolve(
      script.messages?.shift()?.() ?? answer({ turn: "t", ordinal: 1 }, 202),
    );
  });
  return posted;
}

function backlogged(): Response {
  return new Response(JSON.stringify({ error: { code: "ThreadBacklogged" } }), {
    status: 429,
    headers: { "retry-after": "0" },
  });
}

function wrapper(props: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider holder={holderDouble()}>
        {props.children}
      </SessionProvider>
    </QueryClientProvider>
  );
}

function sending() {
  return renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper },
  );
}

const shot: ConversationAttachment = {
  mediaType: "image/png",
  content: new Uint8Array([1, 2, 3]),
};

type Sending = ReturnType<typeof sending>["result"];

async function pressed(
  result: Sending,
  text: string,
  attached: readonly ConversationAttachment[],
): Promise<unknown> {
  let sent: unknown;
  await act(async () => {
    sent = await result.current.composer.onSend(text, attached);
  });
  return sent;
}

function messages(posted: readonly Posted[]) {
  return posted
    .filter((one) => one.url.endsWith("/messages"))
    .map(
      (one) =>
        one.body as {
          readonly turn: string;
          readonly message: string;
          readonly images?: readonly string[];
        },
    );
}

function uploads(posted: readonly Posted[]): readonly Posted[] {
  return posted.filter((one) => one.url.endsWith("/artifacts"));
}

test("the composer takes as many images as the message door names", () => {
  doorAnswering({});
  const { result } = sending();
  expect(result.current.composer.attaches?.countMax).toBe(
    threadMessageImagesMax,
  );
});

test("each image is uploaded as the bytes pasted, under its own type, and the message names what the uploads answered", async () => {
  const posted = doorAnswering({});
  const { result } = sending();
  const other = { mediaType: "image/jpeg", content: new Uint8Array([4]) };
  expect(await pressed(result, "look", [shot, other])).toBe("Sent");
  expect(
    uploads(posted).map((one) => [one.contentType, one.body]),
  ).toStrictEqual([
    ["image/png", shot.content],
    ["image/jpeg", other.content],
  ]);
  const [message] = messages(posted);
  expect(message?.message).toBe("look");
  expect(message?.images).toStrictEqual(["artifact-1", "artifact-2"]);
});

test("a message with no images names none and uploads nothing", async () => {
  const posted = doorAnswering({});
  const { result } = sending();
  await pressed(result, "plain", []);
  expect(uploads(posted)).toHaveLength(0);
  expect(messages(posted)[0]).not.toHaveProperty("images");
});

test("a backlogged mailbox hands the message back, and the same text and images pressed again reach the same row with the same images", async () => {
  const posted = doorAnswering({
    messages: [backlogged, backlogged, backlogged],
  });
  const { result } = sending();
  expect(await pressed(result, "look", [shot])).toBe("Kept");
  expect(await pressed(result, "look", [shot])).toBe("Sent");
  const [first, , , again] = messages(posted);
  expect(again?.turn).toBe(first?.turn);
  expect(again?.images).toStrictEqual(first?.images);
  expect(uploads(posted)).toHaveLength(1);
});

test("editing the text, attaching an image or removing one each release the turn", async () => {
  const posted = doorAnswering({
    messages: Array.from({ length: 15 }, () => backlogged),
  });
  const { result } = sending();
  const other = { mediaType: "image/png", content: new Uint8Array([9]) };
  const turnOf = async (
    text: string,
    attached: readonly ConversationAttachment[],
  ): Promise<string | undefined> => {
    expect(await pressed(result, text, attached)).toBe("Kept");
    return messages(posted).at(-1)?.turn;
  };
  const first = await turnOf("look", [shot]);
  const edited = await turnOf("look again", [shot]);
  const attached = await turnOf("look again", [shot, other]);
  const removed = await turnOf("look again", [shot]);
  expect(new Set([first, edited, attached, removed]).size).toBe(4);
  expect(await turnOf("look again", [shot])).toBe(removed);
});

test("an upload that fails sends nothing, and the message is handed back", async () => {
  const posted = doorAnswering({
    uploads: [
      () => answer({ error: { code: "ArtifactTooLarge" }, bytesMax: 1 }, 413),
    ],
  });
  const { result } = sending();
  const other = { mediaType: "image/png", content: new Uint8Array([9]) };
  expect(await pressed(result, "look", [other, shot])).toBe("Kept");
  expect(uploads(posted)).toHaveLength(1);
  expect(messages(posted)).toHaveLength(0);
});

test("an upload that failed part way uploads only what the project has not taken when pressed again", async () => {
  const posted = doorAnswering({
    uploads: [
      () => answer({ artifact: "artifact-first", digest: "d" }, 201),
      () => answer({ error: { code: "Fault" } }, 500),
    ],
  });
  const { result } = sending();
  const other = { mediaType: "image/png", content: new Uint8Array([9]) };
  expect(await pressed(result, "look", [shot, other])).toBe("Kept");
  expect(await pressed(result, "look", [shot, other])).toBe("Sent");
  expect(uploads(posted).map((one) => one.body)).toStrictEqual([
    shot.content,
    other.content,
    other.content,
  ]);
  expect(messages(posted)[0]?.images?.[0]).toBe("artifact-first");
});
