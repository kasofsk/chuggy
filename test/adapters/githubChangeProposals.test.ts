/**
 * The GitHub proposal adapter against a recording forge: the one request a
 * create makes, the one a read makes, and what every way of not answering
 * comes to.
 *
 * NO REQUEST IS THE ASSERTION HALF THE TIME. A remote this forge does not
 * address, a head outside the branch namespace, a body that could never carry
 * the marker back and a credential the composition will not hand over are all
 * answered without reaching the network at all, and the recorder is what proves
 * it.
 *
 * THE SECRET IS A SENTINEL. The credential is a value no other fixture string
 * contains, so a case can assert it stands in exactly one header and in nothing
 * the adapter returns.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  githubChangeProposals,
  githubChangeProposalsDefaults,
} from "../../src/adapters/forge/githubChangeProposals.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredential,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  changeProposalRequest,
  proposalTitleCharsMax,
  reconcileChangeProposal,
  type ChangeProposalEvidence,
  type ChangeProposalPort,
  type ChangeProposalRequest,
  type ForgeCredentialPort,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";

/** The secret the fixture composition hands out, which must reach one header and nothing else. */
const fixtureSecret = "forge-secret-z9y8x7";

const fixtureForgeBinding = asForgeBindingId("forge-alpha");
const fixtureIdentity = asChangeProposalRequestIdentity("a".repeat(64));
const fixtureHeadCommit = asGitObjectId("b".repeat(40));
const fixtureBaseCommit = asGitObjectId("c".repeat(40));
const fixtureRemote = "PR_kwDOnode17";
const fixtureDisplayUrl = "https://github.com/kasofsk/chuggy/pull/17";

/** Two commits no request names, so a case can tell an answered field from an echoed one. */
const fixtureAnsweredHeadCommit = asGitObjectId("d".repeat(40));
const fixtureAnsweredBaseCommit = asGitObjectId("e".repeat(40));

/** One request whose body carries its own marker, which is what a read can conclude. */
function fixtureRequest(
  overrides: Partial<ChangeProposalRequest> = {},
): ChangeProposalRequest {
  const marker = `chuggy-handoff:${fixtureIdentity}`;
  return {
    ...changeProposalRequest({
      binding: {
        forge: fixtureForgeBinding,
        credential: asForgeCredentialReference("forge-alpha-proposals"),
      },
      repository: asRepositoryId("https://github.com/kasofsk/chuggy"),
      request: fixtureIdentity,
      headCommit: fixtureHeadCommit,
      baseRef: asGitRefName("refs/heads/main"),
      baseCommit: fixtureBaseCommit,
      title: "Publish the accepted revision",
      body: `One deterministic request.\n\n${marker}\n`,
    }),
    ...overrides,
  };
}

/** One recorded forge request, kept as plain strings so a case can assert the whole of it. */
interface ForgeCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

interface ForgeRecorder {
  readonly requestFetch: typeof fetch;
  readonly calls: ForgeCall[];
}

/** The address a request was made to, whichever of the three shapes it arrived in. */
function fixtureUrlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The forge this suite composes the adapter with, answering the given answers in order. */
function fixtureForge(answers: readonly (Response | Error)[]): ForgeRecorder {
  const calls: ForgeCall[] = [];
  let served = 0;
  const requestFetch: typeof fetch = (input, init) => {
    const request = init ?? {};
    calls.push({
      url: fixtureUrlOf(input),
      method: String(request.method),
      headers: { ...(request.headers as Record<string, string>) },
      body: typeof request.body === "string" ? request.body : undefined,
    });
    const answer = answers[served];
    served += 1;
    if (answer === undefined)
      return Promise.reject(new Error("the fixture forge ran out"));
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { requestFetch, calls };
}

/** The composition's credential answer, one resolution for every binding. */
function fixtureCredentials(
  resolved: "Credential" | "Denied" | "Unavailable",
): ForgeCredentialPort {
  return {
    credential: () =>
      Promise.resolve(
        resolved === "Credential"
          ? {
              resolved: "Credential" as const,
              credential: asForgeCredential(fixtureSecret),
            }
          : { resolved },
      ),
  };
}

/** The adapter over one recorder, every bound left at the value a deployment gets by default. */
function fixtureAdapter(
  recorder: ForgeRecorder,
  resolved: "Credential" | "Denied" | "Unavailable" = "Credential",
  responseBytesMax: number = githubChangeProposalsDefaults.responseBytesMax,
): ChangeProposalPort {
  return githubChangeProposals({
    credentials: fixtureCredentials(resolved),
    fetch: recorder.requestFetch,
    responseBytesMax,
  });
}

/** One pull request as this forge reports it, which every case narrows to what it is about. */
function fixturePull(
  request: ChangeProposalRequest,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    node_id: fixtureRemote,
    html_url: fixtureDisplayUrl,
    title: request.title,
    body: request.body,
    state: "open",
    merged_at: null,
    head: { ref: `chuggy/handoff/${fixtureIdentity}`, sha: fixtureHeadCommit },
    base: {
      ref: "main",
      sha: fixtureBaseCommit,
      repo: { full_name: "kasofsk/chuggy" },
    },
    ...overrides,
  };
}

function fixtureAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function fixtureRefusal(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response("{}", { status, headers });
}

/** Whether the body of one answer was given back, which a refused read owes the connection. */
interface FixtureCancelled {
  value: boolean;
}

/** One answer whose body records having been cancelled and is never drawn on unless it is read. */
function fixtureWatchedAnswer(
  text: string,
  headers: Record<string, string>,
  cancelled: FixtureCancelled,
): Response {
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
    cancel: () => {
      cancelled.value = true;
    },
  });
  return new Response(body, { status: 200, headers });
}

/** The evidence a forge answering with the fixture pull request stands for. */
function fixtureEvidence(
  request: ChangeProposalRequest,
): ChangeProposalEvidence {
  return {
    identity: {
      forge: fixtureForgeBinding,
      remote: asProposalRemoteIdentity(fixtureRemote),
    },
    repository: request.repository,
    marker: request.marker,
    head: request.head,
    base: request.base,
    title: request.title,
    body: request.body,
    status: "Open",
    url: asProposalDisplayUrl(fixtureDisplayUrl),
  };
}

test("a created proposal is asked for once, addressed and headed exactly", async () => {
  const request = fixtureRequest();
  const recorder = fixtureForge([fixtureAnswer(201, fixturePull(request))]);
  const created = await fixtureAdapter(recorder).create(request);
  assert.deepEqual(created, {
    created: "Created",
    evidence: fixtureEvidence(request),
  });
  assert.equal(recorder.calls.length, 1);
  const call = recorder.calls[0];
  assert.equal(call?.url, "https://api.github.com/repos/kasofsk/chuggy/pulls");
  assert.equal(call?.method, "POST");
  assert.deepEqual(call?.headers, {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${fixtureSecret}`,
    "user-agent": "chuggy-finalizer",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(call?.body ?? ""), {
    title: request.title,
    body: request.body,
    head: `chuggy/handoff/${fixtureIdentity}`,
    base: "main",
  });
});

test("a proposal the forge says already exists is unsettled until it is read back", async () => {
  const request = fixtureRequest();
  const recorder = fixtureForge([
    fixtureAnswer(422, { message: "A pull request already exists." }),
    fixtureAnswer(200, [fixturePull(request)]),
  ]);
  const adapter = fixtureAdapter(recorder);
  assert.deepEqual(await adapter.create(request), { created: "Ambiguous" });
  assert.deepEqual(await adapter.readByMarker(request), {
    read: "Found",
    evidence: fixtureEvidence(request),
  });
  assert.equal(recorder.calls.length, 2);
  assert.equal(
    recorder.calls[1]?.url,
    `https://api.github.com/repos/kasofsk/chuggy/pulls?state=all&head=kasofsk%3Achuggy%2Fhandoff%2F${fixtureIdentity}&per_page=${String(githubChangeProposalsDefaults.proposalsPerReadMax)}`,
  );
  assert.equal(recorder.calls[1]?.method, "GET");
  assert.equal(recorder.calls[1]?.body, undefined);
});

test("a forge that refuses this caller denies and a spent allowance is an outage", async () => {
  const request = fixtureRequest();
  const denying = fixtureForge([fixtureRefusal(403), fixtureRefusal(404)]);
  const denied = fixtureAdapter(denying);
  assert.deepEqual(await denied.create(request), { created: "Denied" });
  assert.deepEqual(await denied.readByMarker(request), { read: "Denied" });
  const busy = fixtureForge([
    fixtureRefusal(403, { "x-ratelimit-remaining": "0" }),
    fixtureRefusal(429),
  ]);
  const limited = fixtureAdapter(busy);
  assert.deepEqual(await limited.create(request), { created: "Unavailable" });
  assert.deepEqual(await limited.readByMarker(request), {
    read: "Unavailable",
  });
});

test("a forge that failed or stopped leaves a create ambiguous and a read unavailable", async () => {
  const request = fixtureRequest();
  const answers: readonly (Response | Error)[] = [
    fixtureRefusal(500),
    new Error("the forge stopped"),
    new Response("{not json", { status: 200 }),
  ];
  for (const answer of answers) {
    const creating = fixtureForge([answer]);
    assert.deepEqual(await fixtureAdapter(creating).create(request), {
      created: "Ambiguous",
    });
    assert.equal(creating.calls.length, 1);
  }
  for (const answer of answers) {
    const reading = fixtureForge([answer]);
    assert.deepEqual(await fixtureAdapter(reading).readByMarker(request), {
      read: "Unavailable",
    });
  }
});

test("a read answers with the proposal carrying this request's marker and nothing else", async () => {
  const request = fixtureRequest();
  const foreign = fixturePull(request, { body: "somebody else's work" });
  const recorder = fixtureForge([
    fixtureAnswer(200, [foreign, fixturePull(request)]),
    fixtureAnswer(200, [foreign]),
    fixtureAnswer(200, []),
  ]);
  const adapter = fixtureAdapter(recorder);
  assert.deepEqual(await adapter.readByMarker(request), {
    read: "Found",
    evidence: fixtureEvidence(request),
  });
  assert.deepEqual(await adapter.readByMarker(request), { read: "Absent" });
  assert.deepEqual(await adapter.readByMarker(request), { read: "Absent" });
});

test("a page filled to the bound with no match is not an absence", async () => {
  const request = fixtureRequest();
  const foreign = fixturePull(request, { body: "somebody else's work" });
  const page = Array.from(
    { length: githubChangeProposalsDefaults.proposalsPerReadMax },
    () => foreign,
  );
  const full = fixtureForge([fixtureAnswer(200, page)]);
  assert.deepEqual(await fixtureAdapter(full).readByMarker(request), {
    read: "Unavailable",
  });
  const room = fixtureForge([fixtureAnswer(200, page.slice(1))]);
  assert.deepEqual(await fixtureAdapter(room).readByMarker(request), {
    read: "Absent",
  });
});

test("a response past its byte bound is not read", async () => {
  const request = fixtureRequest();
  const wide = fixturePull(request, { title: "w".repeat(4_096) });
  const creating = fixtureForge([fixtureAnswer(201, wide)]);
  assert.deepEqual(
    await fixtureAdapter(creating, "Credential", 64).create(request),
    {
      created: "Ambiguous",
    },
  );
  const reading = fixtureForge([fixtureAnswer(200, [wide])]);
  assert.deepEqual(
    await fixtureAdapter(reading, "Credential", 64).readByMarker(request),
    { read: "Unavailable" },
  );
});

test("a remote this forge does not address is refused without a request", async () => {
  const remotes = [
    "platform-desires",
    "https://gitlab.invalid/kasofsk/chuggy",
    "https://github.com/kasofsk/chuggy/extra",
    "https://github.com/kasofsk",
    "http://github.com/kasofsk/chuggy",
  ];
  for (const remote of remotes) {
    const request = fixtureRequest({ repository: asRepositoryId(remote) });
    const recorder = fixtureForge([]);
    const adapter = fixtureAdapter(recorder);
    assert.deepEqual(await adapter.create(request), { created: "Denied" });
    assert.deepEqual(await adapter.readByMarker(request), { read: "Denied" });
    assert.equal(recorder.calls.length, 0);
  }
});

test("a head outside the branch namespace is refused without a request", async () => {
  const request = fixtureRequest({
    head: { ref: asGitRefName("refs/tags/v1"), commit: fixtureHeadCommit },
  });
  const recorder = fixtureForge([]);
  const adapter = fixtureAdapter(recorder);
  assert.deepEqual(await adapter.create(request), { created: "Denied" });
  assert.deepEqual(await adapter.readByMarker(request), { read: "Denied" });
  assert.equal(recorder.calls.length, 0);
});

test("a body that could never carry the marker back is refused without a request", async () => {
  const request = fixtureRequest({ body: "no marker at all" });
  const recorder = fixtureForge([]);
  const adapter = fixtureAdapter(recorder);
  assert.deepEqual(await adapter.create(request), { created: "Denied" });
  assert.deepEqual(await adapter.readByMarker(request), { read: "Denied" });
  assert.equal(recorder.calls.length, 0);
});

test("a proposal past the bounds a stored row holds is not this request's", async () => {
  const request = fixtureRequest();
  const unusable = [
    { title: "t".repeat(proposalTitleCharsMax + 1) },
    { head: { ref: "chuggy/handoff/one", sha: "short" } },
    { base: { ref: "main", sha: fixtureBaseCommit, repo: null } },
    { node_id: "n".repeat(4_096) },
  ];
  for (const overrides of unusable) {
    const recorder = fixtureForge([
      fixtureAnswer(200, [fixturePull(request, overrides)]),
    ]);
    assert.deepEqual(await fixtureAdapter(recorder).readByMarker(request), {
      read: "Absent",
    });
  }
});

test("a repository the forge spells its own way is the one this request addressed", async () => {
  const request = fixtureRequest();
  const answered = {
    base: {
      ref: "main",
      sha: fixtureBaseCommit,
      repo: { full_name: "Kasofsk/Chuggy" },
    },
  };
  const creating = fixtureForge([
    fixtureAnswer(201, fixturePull(request, answered)),
  ]);
  assert.deepEqual(await fixtureAdapter(creating).create(request), {
    created: "Created",
    evidence: fixtureEvidence(request),
  });
  const reading = fixtureForge([
    fixtureAnswer(200, [fixturePull(request, answered)]),
  ]);
  assert.deepEqual(await fixtureAdapter(reading).readByMarker(request), {
    read: "Found",
    evidence: fixtureEvidence(request),
  });
});

test("the credential reaches one header and nothing the adapter returns", async () => {
  const request = fixtureRequest();
  const recorder = fixtureForge([
    fixtureAnswer(201, fixturePull(request)),
    fixtureAnswer(200, [fixturePull(request)]),
  ]);
  const adapter = fixtureAdapter(recorder);
  const created = await adapter.create(request);
  const read = await adapter.readByMarker(request);
  assert.equal(JSON.stringify([created, read]).includes(fixtureSecret), false);
  for (const call of recorder.calls) {
    assert.equal(call.headers["authorization"], `Bearer ${fixtureSecret}`);
    const said = JSON.stringify({
      url: call.url,
      method: call.method,
      body: call.body,
      accept: call.headers["accept"],
      agent: call.headers["user-agent"],
    });
    assert.equal(said.includes(fixtureSecret), false);
  }
});

test("a credential the composition will not hand over is answered without a request", async () => {
  const request = fixtureRequest();
  const denied = fixtureForge([]);
  assert.deepEqual(await fixtureAdapter(denied, "Denied").create(request), {
    created: "Denied",
  });
  assert.deepEqual(
    await fixtureAdapter(denied, "Denied").readByMarker(request),
    { read: "Denied" },
  );
  const unavailable = fixtureForge([]);
  assert.deepEqual(
    await fixtureAdapter(unavailable, "Unavailable").create(request),
    { created: "Unavailable" },
  );
  assert.deepEqual(
    await fixtureAdapter(unavailable, "Unavailable").readByMarker(request),
    { read: "Unavailable" },
  );
  assert.equal(denied.calls.length + unavailable.calls.length, 0);
});

test("evidence carries what the forge answered and never what the request asked", async () => {
  const request = fixtureRequest();
  const edited = `${request.marker}\n\nsomebody rewrote the case.`;
  const cases = [
    {
      answered: {
        head: { ref: "chuggy/handoff/other", sha: fixtureAnsweredHeadCommit },
      },
      evidence: {
        head: {
          ref: asGitRefName("refs/heads/chuggy/handoff/other"),
          commit: fixtureAnsweredHeadCommit,
        },
      },
      contradiction: "HeadMismatch",
    },
    {
      answered: {
        base: {
          ref: "release",
          sha: fixtureAnsweredBaseCommit,
          repo: { full_name: "kasofsk/chuggy" },
        },
      },
      evidence: {
        base: {
          ref: asGitRefName("refs/heads/release"),
          commit: fixtureAnsweredBaseCommit,
        },
      },
      contradiction: "BaseMismatch",
    },
    {
      answered: { title: "Another title entirely", body: edited },
      evidence: { title: "Another title entirely", body: edited },
      contradiction: "MetadataMismatch",
    },
    {
      answered: {
        base: {
          ref: "main",
          sha: fixtureBaseCommit,
          repo: { full_name: "other/repository" },
        },
      },
      evidence: {
        repository: asRepositoryId("https://github.com/other/repository"),
      },
      contradiction: "RepositoryMismatch",
    },
  ] as const;
  for (const one of cases) {
    const recorder = fixtureForge([
      fixtureAnswer(200, [fixturePull(request, one.answered)]),
    ]);
    const read = await fixtureAdapter(recorder).readByMarker(request);
    const answered = { ...fixtureEvidence(request), ...one.evidence };
    assert.deepEqual(read, { read: "Found", evidence: answered });
    assert.deepEqual(reconcileChangeProposal(request, read), {
      reconciled: "Contradictory",
      contradiction: one.contradiction,
      evidence: answered,
    });
  }
});

test("a proposal the forge has closed or merged carries that standing", async () => {
  const request = fixtureRequest();
  const closed = fixtureForge([
    fixtureAnswer(200, [
      fixturePull(request, { state: "closed", merged_at: null }),
    ]),
  ]);
  assert.deepEqual(await fixtureAdapter(closed).readByMarker(request), {
    read: "Found",
    evidence: { ...fixtureEvidence(request), status: "Closed" },
  });
  const merged = fixtureForge([
    fixtureAnswer(200, [
      fixturePull(request, {
        state: "closed",
        merged_at: "2026-08-28T09:00:00Z",
      }),
    ]),
  ]);
  assert.deepEqual(await fixtureAdapter(merged).readByMarker(request), {
    read: "Found",
    evidence: { ...fixtureEvidence(request), status: "Merged" },
  });
});

test("a forge naming a delay is an outage under the status it also denies with", async () => {
  const request = fixtureRequest();
  const throttled = fixtureForge([
    fixtureRefusal(403, { "retry-after": "60" }),
    fixtureRefusal(403, { "retry-after": "60" }),
  ]);
  const adapter = fixtureAdapter(throttled);
  assert.deepEqual(await adapter.create(request), { created: "Unavailable" });
  assert.deepEqual(await adapter.readByMarker(request), {
    read: "Unavailable",
  });
  const limited = fixtureForge([fixtureRefusal(429, { "retry-after": "60" })]);
  assert.deepEqual(await fixtureAdapter(limited).create(request), {
    created: "Unavailable",
  });
});

test("a response declaring more bytes than the bound gives its body back", async () => {
  const request = fixtureRequest();
  const cancelled = { value: false };
  const recorder = fixtureForge([
    fixtureWatchedAnswer(
      JSON.stringify(fixturePull(request)),
      { "content-length": "9999" },
      cancelled,
    ),
  ]);
  assert.deepEqual(
    await fixtureAdapter(recorder, "Credential", 64).create(request),
    { created: "Ambiguous" },
  );
  assert.equal(cancelled.value, true);
});

test("a display URL this forge did not serve is not carried into evidence", async () => {
  const request = fixtureRequest();
  const recorder = fixtureForge([
    fixtureAnswer(200, [
      fixturePull(request, {
        html_url: "https://elsewhere.invalid/kasofsk/chuggy/pull/17",
      }),
    ]),
  ]);
  const read = await fixtureAdapter(recorder).readByMarker(request);
  assert.equal(read.read, "Found");
  assert.equal(read.read === "Found" ? read.evidence.url : "unread", undefined);
});
