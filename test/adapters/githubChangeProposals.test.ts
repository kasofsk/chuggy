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
  githubChangeProposalsBranded,
  githubChangeProposalsDefaults,
  githubChangeProposalsPerPageMax,
  type GithubChangeProposalsHosts,
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

/** The ticket's own work branch, as the forge names it and as a ref name holds it. */
const fixtureHeadBranch = "chuggy/footer-2026";
const fixtureHeadRef = asGitRefName(`refs/heads/${fixtureHeadBranch}`);
const fixtureHeadCommit = asGitObjectId("b".repeat(40));
const fixtureBaseCommit = asGitObjectId("c".repeat(40));
const fixtureRemote = "PR_kwDOnode17";
const fixtureDisplayUrl = "https://github.com/kasofsk/chuggy/pull/17";

/** The code point no stored row holds, written as an escape so a fixture stays text. */
const fixtureNul = "\u0000";

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
      headRef: fixtureHeadRef,
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
  readonly redirect: RequestInit["redirect"];
}

interface ForgeRecorder {
  readonly requestFetch: typeof fetch;
  readonly calls: ForgeCall[];
}

/** Whether one answer is a redirect, which the platform treats as neither an answer nor a refusal. */
function fixtureRedirects(answer: Response): boolean {
  return answer.status >= 300 && answer.status < 400;
}

/** The address a request was made to, whichever of the three shapes it arrived in. */
function fixtureUrlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * The forge this suite composes the adapter with, answering the given answers
 * in order and treating a redirect the way the platform does: a request that
 * refused one is rejected, and one that did not is made a second time.
 */
function fixtureForge(answers: readonly (Response | Error)[]): ForgeRecorder {
  const calls: ForgeCall[] = [];
  let served = 0;
  const serve = (
    input: string | URL | Request,
    request: RequestInit,
  ): Promise<Response> => {
    calls.push({
      url: fixtureUrlOf(input),
      method: String(request.method),
      headers: { ...(request.headers as Record<string, string>) },
      body: typeof request.body === "string" ? request.body : undefined,
      redirect: request.redirect,
    });
    const answer = answers[served];
    served += 1;
    if (answer === undefined)
      return Promise.reject(new Error("the fixture forge ran out"));
    if (answer instanceof Error) return Promise.reject(answer);
    if (!fixtureRedirects(answer)) return Promise.resolve(answer);
    if (request.redirect === "error")
      return Promise.reject(new TypeError("the fixture forge redirected"));
    return serve(answer.headers.get("location") ?? "", {
      headers: request.headers ?? {},
      method: "GET",
    });
  };
  const requestFetch: typeof fetch = (input, init) => serve(input, init ?? {});
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
    head: { ref: fixtureHeadBranch, sha: fixtureHeadCommit },
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
    head: fixtureHeadBranch,
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
    `https://api.github.com/repos/kasofsk/chuggy/pulls?state=all&head=kasofsk%3Achuggy%2Ffooter-2026&per_page=${String(githubChangeProposalsDefaults.proposalsPerReadMax)}`,
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

/**
 * A person may edit a proposal's title or body past what a stored row holds,
 * and the forge takes it. What this pins is that the marker is what decides
 * whose proposal it is, so a proposal carrying it that cannot be held is found
 * and unreadable rather than absent — an absence is what would spend the
 * request's creations opening a proposal the forge already holds.
 */
test("a proposal carrying the marker past the bounds a stored row holds is not an absence", async () => {
  const request = fixtureRequest();
  const unholdable = [
    { title: "t".repeat(proposalTitleCharsMax + 1) },
    { head: { ref: fixtureHeadBranch, sha: "short" } },
    { base: { ref: "main", sha: fixtureBaseCommit, repo: null } },
    { node_id: "n".repeat(4_096) },
  ];
  for (const overrides of unholdable) {
    const recorder = fixtureForge([
      fixtureAnswer(200, [fixturePull(request, overrides)]),
    ]);
    assert.deepEqual(
      await fixtureAdapter(recorder).readByMarker(request),
      { read: "Unavailable" },
      JSON.stringify(overrides),
    );
  }
});

/**
 * A NUL is no character a stored row holds, so every brand refuses one. What
 * this pins is that the refusal reaches the caller as the port's own answer: a
 * create the forge answered with one is unsettled and a read of the proposal
 * carrying the marker is unavailable, where a throw would have failed the pass
 * the finalizer made it in.
 */
test("a forge answer carrying a NUL is unsettled rather than thrown", async () => {
  const request = fixtureRequest();
  const nulled = [
    { node_id: `${fixtureRemote}${fixtureNul}` },
    {
      head: {
        ref: `${fixtureHeadBranch}${fixtureNul}`,
        sha: fixtureHeadCommit,
      },
    },
    {
      base: {
        ref: `main${fixtureNul}`,
        sha: fixtureBaseCommit,
        repo: { full_name: "kasofsk/chuggy" },
      },
    },
    {
      base: {
        ref: "main",
        sha: fixtureBaseCommit,
        repo: { full_name: `kasofsk/chug${fixtureNul}gy` },
      },
    },
    { title: `${request.title}${fixtureNul}` },
    { body: `${request.body}${fixtureNul}` },
  ];
  for (const overrides of nulled) {
    const answered = JSON.stringify(overrides);
    const creating = fixtureForge([
      fixtureAnswer(201, fixturePull(request, overrides)),
    ]);
    assert.deepEqual(
      await fixtureAdapter(creating).create(request),
      { created: "Ambiguous" },
      `a create is unsettled: ${answered}`,
    );
    const reading = fixtureForge([
      fixtureAnswer(200, [fixturePull(request, overrides)]),
    ]);
    assert.deepEqual(
      await fixtureAdapter(reading).readByMarker(request),
      { read: "Unavailable" },
      `a read cannot hold what it found: ${answered}`,
    );
  }
});

test("a read bound past the page this forge serves is refused at construction", () => {
  const constructed = (proposalsPerReadMax: number) =>
    githubChangeProposals({
      credentials: fixtureCredentials("Credential"),
      fetch: fixtureForge([]).requestFetch,
      proposalsPerReadMax,
    });
  assert.ok(constructed(githubChangeProposalsPerPageMax));
  assert.throws(
    () => constructed(githubChangeProposalsPerPageMax + 1),
    RangeError,
    "a bound the forge would not serve is refused",
  );
  assert.throws(() => constructed(0), RangeError);
  assert.ok(
    githubChangeProposalsDefaults.proposalsPerReadMax <=
      githubChangeProposalsPerPageMax,
  );
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
        head: { ref: "chuggy/other-ticket", sha: fixtureAnsweredHeadCommit },
      },
      evidence: {
        head: {
          ref: asGitRefName("refs/heads/chuggy/other-ticket"),
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
  const nulled = fixtureForge([
    fixtureAnswer(200, [
      fixturePull(request, { html_url: `${fixtureDisplayUrl}${fixtureNul}` }),
    ]),
  ]);
  const carried = await fixtureAdapter(nulled).readByMarker(request);
  assert.equal(carried.read, "Found", "a URL no row holds is not a mismatch");
  assert.equal(
    carried.read === "Found" ? carried.evidence.url : "unread",
    undefined,
  );
});

/**
 * A binding names the repositories a forge holds and the API it is asked
 * through, and a composition that took the first and defaulted the second would
 * put that forge's credential in a request to `api.github.com`.
 */
test("a forge is reached at the two hosts it was composed with, or at neither", async () => {
  const request = fixtureRequest({
    repository: asRepositoryId("https://forge.invalid/kasofsk/chuggy"),
  });
  const recorder = fixtureForge([fixtureAnswer(201, fixturePull(request))]);
  const bound = githubChangeProposals({
    credentials: fixtureCredentials("Credential"),
    fetch: recorder.requestFetch,
    hosts: { apiHost: "api.forge.invalid", repositoryHost: "forge.invalid" },
  });
  assert.equal((await bound.create(request)).created, "Created");
  assert.equal(
    recorder.calls[0]?.url,
    "https://api.forge.invalid/repos/kasofsk/chuggy/pulls",
  );
  assert.throws(
    () =>
      githubChangeProposals({
        credentials: fixtureCredentials("Credential"),
        fetch: recorder.requestFetch,
        hosts: {
          repositoryHost: "forge.invalid",
        } as unknown as GithubChangeProposalsHosts,
      }),
    TypeError,
    "a repository host without its API host composes nothing",
  );
  assert.throws(
    () =>
      githubChangeProposals({
        credentials: fixtureCredentials("Credential"),
        fetch: recorder.requestFetch,
        hosts: { apiHost: ":80", repositoryHost: "forge.invalid" },
      }),
    /github proposals: the API host is not a host/u,
    "a host no URL parses is refused as this adapter's own",
  );
});

test("a redirect on the create is refused rather than followed", async () => {
  const request = fixtureRequest();
  const recorder = fixtureForge([
    new Response("", {
      status: 301,
      headers: { location: "https://api.github.com/repositories/9/pulls" },
    }),
    fixtureAnswer(200, [fixturePull(request)]),
  ]);
  assert.deepEqual(await fixtureAdapter(recorder).create(request), {
    created: "Ambiguous",
  });
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.redirect, "error");
});

test("a brand's own refusal is an absence and anything else it raises escapes", () => {
  assert.equal(
    githubChangeProposalsBranded(
      `${fixtureRemote}${fixtureNul}`,
      asProposalRemoteIdentity,
    ),
    undefined,
  );
  const faulty = (): string => {
    throw new TypeError("a brand this tree composed wrongly");
  };
  assert.throws(
    () => {
      githubChangeProposalsBranded(fixtureRemote, faulty);
    },
    TypeError,
    "a throw that is no refusal is not an answer",
  );
});
