import assert from "node:assert/strict";
import test from "node:test";

import { workerErrorPath } from "../../src/contract/http.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import {
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
} from "../../src/contract/workerPlane.ts";
import { poolJobPlaneClient } from "../../src/adapters/http/poolJobPlaneClient.ts";
import type { WorkerPoolJobEnd } from "../../src/interpreter/workerPoolClient.ts";

const ended: WorkerPoolJobEnd = {
  kind: "Job",
  job: {
    assignment: "job-one",
    callbackUrl: "https://worker-plane.invalid/v1/ticket-execution",
    bearer: "chgw_job",
  },
  text: "stopped at its deadline",
  killed: "Deadline",
};

/** One request a job's end made, as it was sent. */
interface Sent {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly release: string | null;
  readonly body: string;
}

/** A plane answering the text's upload with `uploaded` and the end with `ended`, each request recorded. */
function plane(
  uploaded: () => Promise<Response>,
  endedWith: () => Promise<Response>,
): { readonly sent: Sent[]; readonly fetcher: typeof fetch } {
  const sent: Sent[] = [];
  return {
    sent,
    fetcher: async (input, init) => {
      assert.ok(input instanceof URL);
      const headers = new Headers(init?.headers);
      sent.push({
        url: input.href,
        method: init?.method,
        authorization: headers.get("authorization"),
        contentType: headers.get("content-type"),
        release: headers.get(workerContractHeader),
        body: await new Response(init?.body).text(),
      });
      return input.pathname === workerPlaneRoutes.runEnded.path
        ? endedWith()
        : uploaded();
    },
  };
}

/** An answer as the plane sends one, naming its release as every one does. */
const answered = (status: number) => () =>
  Promise.resolve(
    new Response(null, {
      status,
      headers: { [workerContractHeader]: workerContractRelease },
    }),
  );

test("a killed job's text is left first, then its run is ended timed out, each once under the job's own bearer", async () => {
  const { sent, fetcher } = plane(answered(204), answered(204));
  assert.equal(
    await poolJobPlaneClient({ timeoutMs: 1_000 }, fetcher).end(ended),
    "Ended",
  );
  assert.deepEqual(sent, [
    {
      url: `https://worker-plane.invalid${workerPlaneRoutes.artifact.path.replace("*", workerErrorPath)}`,
      method: workerPlaneRoutes.artifact.method,
      authorization: "Bearer chgw_job",
      contentType: workerPlaneBytesMediaType,
      release: workerContractRelease,
      body: "stopped at its deadline",
    },
    {
      url: `https://worker-plane.invalid${workerPlaneRoutes.runEnded.path}`,
      method: workerPlaneRoutes.runEnded.method,
      authorization: "Bearer chgw_job",
      contentType: "application/json",
      release: workerContractRelease,
      body: JSON.stringify({ evidence: "RunTimedOut" }),
    },
  ]);
});

test("a text the plane did not take still has its run ended", async () => {
  for (const uploaded of [
    answered(409),
    answered(503),
    () => Promise.reject(new TypeError("fetch failed")),
  ]) {
    const { sent, fetcher } = plane(uploaded, answered(204));
    assert.equal(
      await poolJobPlaneClient({ timeoutMs: 1_000 }, fetcher).end(ended),
      "Ended",
    );
    assert.equal(sent.length, 2);
  }
});

test("an end the plane refused is final, and anything else is an outage", async () => {
  for (const [status, answer] of [
    [400, "Refused"],
    [401, "Refused"],
    [409, "Refused"],
    [500, "Unavailable"],
    [503, "Unavailable"],
  ] as const)
    assert.equal(
      await poolJobPlaneClient(
        { timeoutMs: 1_000 },
        plane(answered(204), answered(status)).fetcher,
      ).end(ended),
      answer,
      String(status),
    );
  for (const [what, status, body, headers] of [
    [
      "a proxy's own 404",
      404,
      "404 page not found\n",
      { "content-type": "text/plain" },
    ],
    ["a proxy's own 401", 401, "", {}],
    ["a 409 naming no release", 409, "", {}],
    [
      "a 400 naming no release of the plane's",
      400,
      "",
      { [workerContractHeader]: "not a release" },
    ],
  ] as const)
    assert.equal(
      await poolJobPlaneClient(
        { timeoutMs: 1_000 },
        plane(answered(204), () =>
          Promise.resolve(new Response(body, { status, headers })),
        ).fetcher,
      ).end(ended),
      "Unavailable",
      what,
    );
  assert.equal(
    await poolJobPlaneClient(
      { timeoutMs: 1_000 },
      plane(answered(204), () => Promise.reject(new TypeError("fetch failed")))
        .fetcher,
    ).end(ended),
    "Unavailable",
  );
});

test("a timeout that is not a positive whole number is refused", () => {
  for (const timeoutMs of [0, -1, 1.5])
    assert.throws(() => poolJobPlaneClient({ timeoutMs }), /positive integer/u);
});
