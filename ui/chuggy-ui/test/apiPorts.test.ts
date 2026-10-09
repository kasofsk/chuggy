/**
 * The API's ports over a session holder, with the holder, the network and the
 * timer all doubles.
 *
 * Each case sends a real request through them, so what is checked is what the
 * holder is asked and in what order: the bearer for every send, one renewal for
 * a refused one, and the session ended where the issuer will not renew it or
 * the API refuses the fresh bearer too. The double's sign-out takes a turn of
 * the clock, so a refusal said before the session is forgotten shows.
 */

import { expect, test } from "vitest";

import { apiPortsOver } from "../app/core/apiPorts.ts";
import { apiSend } from "../app/core/apiRequest.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";

const installation = { method: "GET", path: "/api/v1/installation" } as const;
const refused = "refuse: the API refused this session, so it was signed out";

interface Held {
  readonly ports: ApiPorts;
  /** What the holder was asked, in the order it was asked. */
  readonly asked: string[];
  /** The `authorization` header each request was sent with. */
  readonly sent: (string | undefined)[];
  readonly waits: { ms: number; signal: AbortSignal | undefined }[];
}

function answer(status: number, headers: Record<string, string> = {}) {
  return new Response("{}", { status, headers });
}

/** Ports over a holder whose issuer renews or does not, and an API that gives
 * `answers` in turn. */
function held(renews: boolean, answers: readonly Response[]): Held {
  const asked: string[] = [];
  const sent: Held["sent"] = [];
  const waits: Held["waits"] = [];
  let bearer = "first";
  const ports = apiPortsOver(
    {
      bearer: () => {
        asked.push("bearer");
        return Promise.resolve(bearer);
      },
      refresh: () => {
        asked.push("refresh");
        if (renews) bearer = "second";
        return Promise.resolve(renews);
      },
      signOut: async () => {
        asked.push("signOut");
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        asked.push("signedOut");
      },
      refuse: (reason) => {
        asked.push(`refuse: ${reason}`);
      },
    },
    (_url, init) => {
      sent.push(init.headers["authorization"]);
      return Promise.resolve(answers[sent.length - 1] ?? answer(500));
    },
    (ms, signal) => {
      waits.push({ ms, signal });
      return Promise.resolve();
    },
  );
  return { ports, asked, sent, waits };
}

test("a request carries the bearer the holder gives, and nothing more is asked of it", async () => {
  const over = held(true, [answer(200)]);

  const result = await apiSend(over.ports, installation);

  expect(result.outcome).toBe("Ok");
  expect(over.sent).toEqual(["Bearer first"]);
  expect(over.asked).toEqual(["bearer"]);
});

test("a refused bearer is renewed and the request sent again under the new one", async () => {
  const over = held(true, [answer(401), answer(200)]);

  const result = await apiSend(over.ports, installation);

  expect(result.outcome).toBe("Ok");
  expect(over.sent).toEqual(["Bearer first", "Bearer second"]);
  expect(over.asked).toEqual(["bearer", "refresh", "bearer"]);
});

test("a session the issuer will not renew is forgotten, then said to be, and is not sent again", async () => {
  const over = held(false, [answer(401), answer(200)]);

  const result = await apiSend(over.ports, installation);

  expect(result.outcome).toBe("Unauthenticated");
  expect(over.sent).toEqual(["Bearer first"]);
  expect(over.asked).toEqual([
    "bearer",
    "refresh",
    "signOut",
    "signedOut",
    refused,
  ]);
});

test("a fresh bearer the API refuses too ends the session the same way", async () => {
  const over = held(true, [answer(401), answer(401)]);

  const result = await apiSend(over.ports, installation);

  expect(result.outcome).toBe("Unauthenticated");
  expect(over.sent).toEqual(["Bearer first", "Bearer second"]);
  expect(over.asked).toEqual([
    "bearer",
    "refresh",
    "bearer",
    "signOut",
    "signedOut",
    refused,
  ]);
});

test("a wait the API names is the timer handed in, under the caller's signal", async () => {
  const caller = new AbortController();
  const over = held(true, [answer(503, { "retry-after": "2" }), answer(200)]);

  const result = await apiSend(over.ports, {
    ...installation,
    signal: caller.signal,
  });

  expect(result.outcome).toBe("Ok");
  expect(over.waits).toHaveLength(1);
  expect(over.waits[0]?.ms).toBe(2_000);
  expect(over.waits[0]?.signal).toBe(caller.signal);
});
