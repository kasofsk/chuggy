/**
 * The follow as it actually runs: the requests it makes, in order, and the
 * waits between them.
 *
 * The machine's suite cannot see any of this. A wait read from the step the
 * response has just replaced still settles every operation, so the only thing
 * that catches it is driving the runner against a server that says `retry-after`
 * and reading back when the waiting happened.
 */

import { expect, test } from "vitest";

import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { apiAttemptsMax } from "../app/core/apiRequest.ts";
import type { ApiFetchInit, ApiPorts } from "../app/core/apiRequest.ts";
import {
  followOperation,
  operationPollIntervalMs,
} from "../app/core/operationFollow.ts";
import type {
  OperationStep,
  OperationSubmission,
} from "../app/core/operationFollow.ts";

const partition = { tenant: "acme", project: "atlas" };
const acceptedAt = "2026-08-26T00:00:00Z";
const backlogSeconds = 30;

function submission(ticket: number): OperationSubmission {
  return {
    operation: "op-1",
    mutation: { mutation: "RevokeTicket", ticket },
  };
}

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

interface Server {
  readonly ports: ApiPorts;
  readonly calls: string[];
  readonly waitsMs: number[];
}

/** A fetch port over scripted answers, recording every call and every wait. */
function serverDouble(answer: (call: string, at: number) => Answer): Server {
  const calls: string[] = [];
  const waitsMs: number[] = [];
  const ports: ApiPorts = {
    fetch: (url: string, init: ApiFetchInit) => {
      const call = `${init.method} ${url}`;
      const said = answer(call, calls.length);
      calls.push(call);
      return Promise.resolve({
        status: said.status,
        headers: {
          get: (name: string) => said.headers?.[name] ?? nativeHttpMediaType,
        },
        text: () =>
          Promise.resolve(
            said.body === undefined ? "" : JSON.stringify(said.body),
          ),
      } as unknown as Response);
    },
    bearer: () => Promise.resolve("token"),
    sleepMs: (ms: number, signal: AbortSignal | undefined) => {
      waitsMs.push(ms);
      return signal?.aborted === true
        ? Promise.reject(new Error("abandoned"))
        : Promise.resolve();
    },
  };
  return { ports, calls, waitsMs };
}

const deferral: Answer = {
  status: 429,
  body: { error: { code: "DispatchBacklog", message: "" } },
  headers: { "retry-after": String(backlogSeconds) },
};

const accepted: Answer = {
  status: 202,
  body: { operation: "op-1", state: "Pending" },
};

const succeeded: Answer = {
  status: 200,
  body: {
    operation: "op-1",
    acceptedAt,
    state: "Succeeded",
    decidedSequence: 91,
  },
};

function project(ticket: number): Answer {
  return {
    status: 200,
    body: {
      partition,
      sequence: 91,
      tickets: [{ ticket, phase: "Revoked", sequence: 91 }],
    },
  };
}

/** Deferred once to exhaustion, then accepted, polled and confirmed. */
function backloggedThenSettles(ticket: number) {
  return serverDouble((call, at) => {
    if (call.startsWith("POST"))
      return at < apiAttemptsMax ? deferral : accepted;
    if (call.includes("/operations/")) return succeeded;
    return project(ticket);
  });
}

test("the wait after a deferral is the one the API asked for", async () => {
  const server = backloggedThenSettles(2);
  const followed = await followOperation(
    server.ports,
    partition,
    submission(2),
    2,
    () => undefined,
  );
  expect(followed.step.step).toBe("Settled");
  const backlogMs = backlogSeconds * 1_000;
  expect(server.waitsMs[apiAttemptsMax - 1]).toBe(backlogMs);
  expect(server.waitsMs.slice(apiAttemptsMax)).toEqual([
    operationPollIntervalMs,
    operationPollIntervalMs,
  ]);
});

test("the follow confirms the first ticket without an exclusive cursor", async () => {
  const server = backloggedThenSettles(1);
  const followed = await followOperation(
    server.ports,
    partition,
    submission(1),
    1,
    () => undefined,
  );
  expect(followed.step).toMatchObject({ step: "Settled", state: "Succeeded" });
  expect(followed.ticket).toEqual({
    ticket: 1,
    phase: "Revoked",
    sequence: 91,
  });
  const confirmation = server.calls.at(-1) ?? "";
  expect(confirmation).toContain("minimumSequence=91");
  expect(confirmation).not.toContain("after=");
});

test("the follow confirms a later ticket with the cursor before it", async () => {
  const server = backloggedThenSettles(2);
  await followOperation(
    server.ports,
    partition,
    submission(2),
    2,
    () => undefined,
  );
  expect(server.calls.at(-1) ?? "").toContain("after=1");
});

test("an abandoned screen stops the follow rather than only its reporting", async () => {
  const controller = new AbortController();
  const seen: OperationStep[] = [];
  const server = backloggedThenSettles(2);
  const followed = await followOperation(
    server.ports,
    partition,
    submission(2),
    2,
    (step) => {
      seen.push(step);
      if (step.step === "Following") controller.abort();
    },
    controller.signal,
  );
  expect(followed.step.step).toBe("Abandoned");
  expect(seen.some((step) => step.step === "Confirming")).toBe(false);
  expect(
    server.calls.some((call) =>
      call.startsWith("GET /api/v1/tenants/acme/projects/atlas?"),
    ),
  ).toBe(false);
});
