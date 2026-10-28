/**
 * A member's own chat over HTTP: each door at its tenant hands the caller and
 * the tenant to the chat and nothing a request could choose, and answers what
 * the chat said as the project thread doors answer it, located at the tenant.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import {
  nativeHttpMediaType,
  threadTurnsAnsweredMax,
} from "../../src/contract/http.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import type { MemberChat } from "../../src/interpreter/memberChat.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId } from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import type { ThreadEntry } from "../../src/interpreter/threadRead.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

const caller = asPrincipal("issuer geoff");
const session = asSessionId("own-geoff");
const at = asPublicInstant("2026-10-28T09:00:00Z");
const entry: ThreadEntry = {
  session,
  owner: "User:geoff",
  state: "Open",
  mine: true,
  turns: 0,
  openedAt: at,
  lastActivityAt: at,
  hidden: false,
};
const authorized = { authorization: "Bearer valid" };

/** A chat answering as one case chooses, recording what each door was handed. */
function chatOf(calls: string[], chat: Partial<MemberChat>): MemberChat {
  const unasked = (door: string) => () => {
    calls.push(door);
    return Promise.reject(new Error(`${door} is not this case's`));
  };
  return {
    abilities: unasked("abilities"),
    projects: unasked("projects"),
    threads: unasked("threads"),
    thread: unasked("thread"),
    threadTranscript: unasked("threadTranscript"),
    openThread: unasked("openThread"),
    sendThreadMessage: unasked("sendThreadMessage"),
    stopThreadTurn: unasked("stopThreadTurn"),
    closeThread: unasked("closeThread"),
    renameThread: unasked("renameThread"),
    hideThread: unasked("hideThread"),
    ...chat,
  };
}

function appOver(chat: MemberChat) {
  return createNativeHttpApp(
    unservedNativeWeb,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: caller },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    chat,
  );
}

function write(url: string, payload: unknown) {
  return {
    method: "POST" as const,
    url,
    headers: { ...authorized, "content-type": nativeHttpMediaType },
    payload: JSON.stringify(payload),
  };
}

test("opening one's own thread is located at the tenant's chat, and refused for want of a chat host or past the limit", async () => {
  const calls: string[] = [];
  const answers = [
    { result: "Opened", thread: entry },
    { result: "AlreadyOpen", thread: entry },
    { result: "NoRunner" },
    { result: "ThreadLimitReached", threadsMax: 10 },
  ] as const;
  let next = 0;
  await using app = appOver(
    chatOf(calls, {
      openThread: (principal, tenant, key) => {
        calls.push(`${principal}:${tenant}:${key}`);
        return Promise.resolve(answers[next++] ?? { result: "NotFound" });
      },
    }),
  );
  const open = () =>
    app.inject(write("/api/v1/tenants/acme/chat/threads", { key: "k-1" }));
  const opened = await open();
  assert.equal(opened.statusCode, 201);
  assert.equal(
    opened.headers["location"],
    "/api/v1/tenants/acme/chat/threads/own-geoff",
  );
  assert.deepEqual(
    nativeHttpEndpoints.openChatThread.response.parse(opened.json()),
    opened.json(),
  );
  assert.equal((await open()).statusCode, 200);
  const hostless = await open();
  assert.equal(hostless.statusCode, 403);
  assert.match(hostless.body, /no chat host in the tenant/u);
  const full = await open();
  assert.equal(full.statusCode, 409);
  assert.equal(full.json<{ threadsMax: number }>().threadsMax, 10);
  assert.deepEqual(calls.slice(0, 1), [`${caller}:acme:k-1`]);
});

test("a thread is read at the tenant, a project one by the project named, and never at a reserved identity", async () => {
  const calls: string[] = [];
  await using app = appOver(
    chatOf(calls, {
      thread: (principal, tenant, asked, query, project) => {
        calls.push(
          `${principal}:${tenant}:${asked}:${String(query.limit)}:${String(project)}`,
        );
        return Promise.resolve({
          result: "Found",
          thread: entry,
          turns: [],
          streams: [],
        });
      },
    }),
  );
  const own = await app.inject({
    url: "/api/v1/tenants/acme/chat/threads/own-geoff",
    headers: authorized,
  });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(
    nativeHttpEndpoints.chatThread.response.parse(own.json()),
    own.json(),
  );
  const projects = await app.inject({
    url: "/api/v1/tenants/acme/chat/threads/own-geoff?project=atlas&limit=1",
    headers: authorized,
  });
  assert.equal(projects.statusCode, 200);
  const reserved = await app.inject({
    url: "/api/v1/tenants/acme/chat/threads/own-geoff?project=%40member-x",
    headers: authorized,
  });
  assert.equal(reserved.statusCode, 400);
  assert.deepEqual(calls, [
    `${caller}:acme:own-geoff:${String(threadTurnsAnsweredMax)}:undefined`,
    `${caller}:acme:own-geoff:1:atlas`,
  ]);
});

test("the listings answer the shapes the contract names, a project page with where the next begins", async () => {
  const calls: string[] = [];
  await using app = appOver(
    chatOf(calls, {
      threads: (principal, tenant) => {
        calls.push(`threads:${principal}:${tenant}`);
        return Promise.resolve({
          result: "Found",
          threads: [
            { ...entry, scope: "Member" },
            {
              ...entry,
              session: asSessionId("atlas-geoff"),
              scope: "Project",
              project: asProjectId("atlas"),
            },
          ],
        });
      },
      projects: (principal, tenant, query) => {
        calls.push(
          `projects:${principal}:${tenant}:${String(query.after)}:${String(query.limit)}`,
        );
        return Promise.resolve({
          result: "Found",
          projects: [
            {
              project: asProjectId("atlas"),
              lifecycle: "Active",
              role: "Developer",
            },
          ],
          nextAfter: asProjectId("atlas"),
        });
      },
      abilities: (principal) =>
        Promise.resolve({
          principal,
          openUnscopedChat: true,
          executeHosted: false,
          registerPersonalRunner: true,
          administerTenant: false,
        }),
    }),
  );
  for (const [url, endpoint] of [
    ["/api/v1/tenants/acme/chat/threads", nativeHttpEndpoints.chatThreads],
    [
      "/api/v1/tenants/acme/chat/projects?after=alpha&limit=1",
      nativeHttpEndpoints.chatProjects,
    ],
    ["/api/v1/tenants/acme/chat/abilities", nativeHttpEndpoints.chatAbilities],
  ] as const) {
    const answered = await app.inject({ url, headers: authorized });
    assert.equal(answered.statusCode, 200, url);
    assert.deepEqual(
      endpoint.response.parse(answered.json()),
      answered.json(),
      url,
    );
  }
  assert.deepEqual(calls, [
    `threads:${caller}:acme`,
    `projects:${caller}:acme:alpha:1`,
  ]);
});

test("a message to one's own thread is refused for want of a chat host as the open door refuses it", async () => {
  await using app = appOver(
    chatOf([], {
      sendThreadMessage: () => Promise.resolve({ result: "NoRunner" }),
    }),
  );
  const answered = await app.inject(
    write("/api/v1/tenants/acme/chat/threads/own-geoff/messages", {
      turn: "turn-1",
      message: "which projects may I see?",
    }),
  );
  assert.equal(answered.statusCode, 403);
  assert.match(answered.body, /no chat host in the tenant/u);
});
