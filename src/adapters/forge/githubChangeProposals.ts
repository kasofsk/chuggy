/**
 * The adapter behind `ChangeProposalPort` for GitHub: the one request that asks
 * for a pull request, and the one that reads back the proposal carrying a
 * request's marker.
 *
 * A CREATE MAY BE AMBIGUOUS AND THAT IS AN ANSWER. A forge that failed, stopped
 * or answered something this tree cannot read leaves the proposal neither made
 * nor unmade, and only the forge can settle it — so an unsettled create is
 * `Ambiguous` and `readByMarker` is what concludes it. The refusal saying a
 * proposal already exists is unsettled for the same reason: it proves some
 * proposal stands on the head branch and says nothing about whose, which is the
 * question the marker answers and prose in an error body does not.
 *
 * EXACTLY ONE FORGE REQUEST IS MADE PER CALL, and there is no retry loop here.
 * `changeProposalPublicationNext` is the retry, bounded by the reconciliation
 * count it is given, so a loop here would be a second unbounded one underneath
 * a bounded one.
 *
 * A CREDENTIAL IS RESOLVED PER ACT AND NEVER HELD. `ForgeCredentialPort`
 * answers it, the composition root answers that port, and the value reaches
 * exactly one header and no diagnostic, evidence field or returned string.
 *
 * THE MARKER IS WHAT MAKES A PROPOSAL THIS REQUEST'S. A pull request the forge
 * returns is evidence only where its body carries the request's marker and the
 * forge names the repository this call addressed; anything else on the same
 * head branch is somebody else's and is not found. The read filters on the head
 * branch alone, because a proposal opened against another base is the
 * `BaseMismatch` the pure layer exists to report rather than a row to hide.
 *
 * NOTHING IS APPENDED TO WHAT A CALLER OFFERS, because evidence is compared
 * against the request field by field and a body this adapter edited could never
 * equal the one it was given. So a request whose own body does not carry its
 * marker is one no read could ever conclude, and is refused before a proposal
 * nothing could recognise is asked for.
 *
 * NOTHING HERE READS AN ENVIRONMENT, a clock or a global. The host, the bounds
 * and `fetch` itself are all given at construction.
 */

import { z } from "zod";

import {
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  proposalBodyCharsMax,
  proposalDisplayUrlCharsMax,
  proposalTitleCharsMax,
  type ChangeProposalCreated,
  type ChangeProposalEvidence,
  type ChangeProposalPort,
  type ChangeProposalRead,
  type ChangeProposalRequest,
  type ChangeProposalStatus,
  type ForgeBinding,
  type ForgeCredential,
  type ForgeCredentialPort,
} from "../../interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
  type GitObjectId,
  type GitRefName,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";

/** Everything the adapter is composed with, `fetch` among them because nothing here reaches a global. */
export interface GithubChangeProposalsOptions {
  readonly credentials: ForgeCredentialPort;
  readonly fetch: typeof fetch;
  readonly apiHost?: string;
  readonly repositoryHost?: string;
  readonly requestTimeoutSecsMax?: number;
  readonly responseBytesMax?: number;
  readonly proposalsPerReadMax?: number;
}

/** The hosts and the bounds a deployment gets when it names none. */
export const githubChangeProposalsDefaults = {
  apiHost: "api.github.com",
  repositoryHost: "github.com",
  requestTimeoutSecsMax: 30,
  responseBytesMax: 1_048_576,
  proposalsPerReadMax: 32,
} as const;

/** The media type this forge answers in, and the one a request body is sent as. */
const githubAcceptMediaType = "application/vnd.github+json";
const githubRequestMediaType = "application/json";

/** The API generation every request pins, so a later default cannot change what a body means. */
const githubApiVersion = "2022-11-28";

/** The agent this tree presents itself to a forge as. */
const githubUserAgent = "chuggy-finalizer";

/** The namespace a proposal's head and base must name, a branch being the only ref a pull request is opened over. */
const githubBranchRefPrefix = "refs/heads/";

/** The header a forge names a spent request allowance in. */
const githubRateLimitRemainingHeader = "x-ratelimit-remaining";

/** The value that header takes when the allowance is gone. */
const githubRateLimitSpent = "0";

/** The statuses that are the forge refusing this caller rather than failing. */
const githubDeniedStatuses: readonly number[] = [401, 403, 404];

/** The status a forge answers a spent allowance with. */
const githubBusyStatus = 429;

const millisecondsPerSecond = 1_000;

/** The segments a repository address may be made of, which is what keeps an address out of a path it could escape. */
const githubAddressSegmentPattern = /^[A-Za-z0-9._-]+$/u;

/** What the adapter holds across acts: its bounds, its hosts and the port its credentials come from. */
interface GithubChangeProposalsState {
  readonly credentials: ForgeCredentialPort;
  readonly requestFetch: typeof fetch;
  readonly apiHost: string;
  readonly repositoryHost: string;
  readonly requestTimeoutSecsMax: number;
  readonly responseBytesMax: number;
  readonly proposalsPerReadMax: number;
}

/** One repository as this forge addresses it. */
interface GithubAddress {
  readonly owner: string;
  readonly name: string;
}

/**
 * What one forge request came to, in the closed vocabulary both calls map into
 * their own. `Unsettled` is everything that neither answered nor refused.
 */
type GithubAnswer =
  | { readonly answer: "Read"; readonly body: unknown }
  | { readonly answer: "Denied" }
  | { readonly answer: "Busy" }
  | { readonly answer: "Unsettled" };

/** Whether one act is authorized, a denial kept apart from an outage all the way into the answer. */
type GithubAuthorized =
  | { readonly authorized: "Credential"; readonly credential: ForgeCredential }
  | {
      readonly authorized: "Refused";
      readonly refusal: "Denied" | "Unavailable";
    };

/** The fields of a pull request this tree reads, every one of them bounded before it is branded. */
const githubPullRequestSchema = z.object({
  node_id: z.string().min(1),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  merged_at: z.string().nullable().optional(),
  head: z.object({ ref: z.string().min(1), sha: z.string() }),
  base: z.object({
    ref: z.string().min(1),
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});

type GithubPullRequest = z.infer<typeof githubPullRequestSchema>;

/** Refuses a bound no later call could work around. */
function githubChangeProposalsBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`github proposals: ${what} is not a positive bound`);
  }
  return value;
}

/** Refuses a host that is not one, so every URL this adapter builds is built from a host it checked once. */
function githubChangeProposalsHost(value: string, what: string): string {
  const url = new URL(`https://${value}`);
  if (url.host !== value || url.pathname !== "/") {
    throw new TypeError(`github proposals: ${what} is not a host`);
  }
  return value;
}

/**
 * The owner and name this forge addresses a repository by, read out of the
 * remote address the repository identity is. Anything but an HTTPS URL naming
 * exactly two path segments on this forge's host is no address of one.
 */
function githubChangeProposalsAddressOf(
  repository: RepositoryId,
  host: string,
): GithubAddress | undefined {
  let url: URL;
  try {
    url = new URL(repository);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.host !== host) return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const segments = url.pathname
    .replace(/\.git$/u, "")
    .split("/")
    .slice(1);
  const [owner, name] = segments;
  if (segments.length !== 2 || owner === undefined || name === undefined) {
    return undefined;
  }
  return githubAddressSegmentPattern.test(owner) &&
    githubAddressSegmentPattern.test(name)
    ? { owner, name }
    : undefined;
}

/** The branch a fully qualified ref names, and nothing for a ref outside the branch namespace. */
function githubChangeProposalsBranchOf(ref: GitRefName): string | undefined {
  if (!ref.startsWith(githubBranchRefPrefix)) return undefined;
  const branch = ref.slice(githubBranchRefPrefix.length);
  return branch.length === 0 ? undefined : branch;
}

/** The pull request collection of one addressed repository. */
function githubChangeProposalsPullsUrl(
  own: GithubChangeProposalsState,
  address: GithubAddress,
): URL {
  return new URL(
    `/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}/pulls`,
    `https://${own.apiHost}`,
  );
}

/** The headers every request carries, the credential reaching exactly one of them. */
function githubChangeProposalsHeaders(
  credential: ForgeCredential,
  sending: boolean,
): Record<string, string> {
  return {
    accept: githubAcceptMediaType,
    authorization: `Bearer ${credential}`,
    "user-agent": githubUserAgent,
    "x-github-api-version": githubApiVersion,
    ...(sending ? { "content-type": githubRequestMediaType } : {}),
  };
}

/** What a refusal was, a spent allowance kept apart from a forge refusing this caller outright. */
function githubChangeProposalsRefusalOf(response: Response): GithubAnswer {
  const spent =
    response.headers.get(githubRateLimitRemainingHeader) ===
    githubRateLimitSpent;
  if (response.status === githubBusyStatus) return { answer: "Busy" };
  if (githubDeniedStatuses.includes(response.status)) {
    return spent ? { answer: "Busy" } : { answer: "Denied" };
  }
  return { answer: "Unsettled" };
}

/**
 * One response's whole text, refused rather than truncated once it passes the
 * bound. The declared length is read first so an oversized body is refused
 * before any of it is drawn on.
 */
async function githubChangeProposalsTextOf(
  response: Response,
  bytesMax: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > bytesMax) {
    throw new RangeError(
      "github proposals: a response declares too many bytes",
    );
  }
  if (response.body === null) {
    throw new TypeError("github proposals: a response carried no body");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body.getReader();
  let text = "";
  let bytes = 0;
  for (let chunks = 0; chunks <= bytesMax; chunks += 1) {
    const read = await reader.read();
    if (read.done) return text + decoder.decode();
    const chunk = read.value as Uint8Array;
    bytes += chunk.byteLength;
    if (bytes > bytesMax) break;
    text += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel();
  throw new RangeError("github proposals: a response passed its byte bound");
}

/** Resolves what authorizes one forge act, which is never stored and never folded into anything. */
async function githubChangeProposalsCredentialOf(
  own: GithubChangeProposalsState,
  binding: ForgeBinding,
): Promise<GithubAuthorized> {
  const resolved = await own.credentials.credential(binding);
  return resolved.resolved === "Credential"
    ? { authorized: "Credential", credential: resolved.credential }
    : { authorized: "Refused", refusal: resolved.resolved };
}

/** Makes the one bounded forge request this act is, every way of not answering being unsettled. */
async function githubChangeProposalsSend(
  own: GithubChangeProposalsState,
  url: URL,
  credential: ForgeCredential,
  body: string | undefined,
): Promise<GithubAnswer> {
  let response: Response;
  try {
    response = await own.requestFetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: githubChangeProposalsHeaders(credential, body !== undefined),
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(
        own.requestTimeoutSecsMax * millisecondsPerSecond,
      ),
    });
  } catch {
    return { answer: "Unsettled" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return githubChangeProposalsRefusalOf(response);
  }
  try {
    const text = await githubChangeProposalsTextOf(
      response,
      own.responseBytesMax,
    );
    return { answer: "Read", body: JSON.parse(text) };
  } catch {
    return { answer: "Unsettled" };
  }
}

/** The commit a forge named, and nothing where it named a width git addresses no object at. */
function githubChangeProposalsCommitOf(sha: string): GitObjectId | undefined {
  return new RegExp(gitObjectIdPattern(), "u").test(sha)
    ? asGitObjectId(sha)
    : undefined;
}

/** The fully qualified ref one branch name is, and nothing where a stored row could not hold it. */
function githubChangeProposalsRefOf(branch: string): GitRefName | undefined {
  const ref = `${githubBranchRefPrefix}${branch}`;
  return ref.length > gitRefNameCharsMax || !ref.isWellFormed()
    ? undefined
    : asGitRefName(ref);
}

/** Where a proposal stands, a merged one told from a closed one by the moment it was merged. */
function githubChangeProposalsStatusOf(
  pull: GithubPullRequest,
): ChangeProposalStatus {
  if (pull.state === "open") return "Open";
  return pull.merged_at === null || pull.merged_at === undefined
    ? "Closed"
    : "Merged";
}

/** The display URL a forge named, absent where a stored row could not hold it. */
function githubChangeProposalsUrlOf(
  pull: GithubPullRequest,
): Pick<ChangeProposalEvidence, "url"> {
  return pull.html_url.length === 0 ||
    pull.html_url.length > proposalDisplayUrlCharsMax ||
    !pull.html_url.isWellFormed()
    ? {}
    : { url: asProposalDisplayUrl(pull.html_url) };
}

/**
 * What one pull request is evidence of, and nothing where it is not this
 * request's. A proposal is this request's only where the forge answered for the
 * addressed repository and the body carries the marker, and only where every
 * field of it is one a stored row holds.
 */
function githubChangeProposalsEvidenceOf(
  request: ChangeProposalRequest,
  address: GithubAddress,
  pull: GithubPullRequest,
): ChangeProposalEvidence | undefined {
  const body = pull.body ?? "";
  if (pull.base.repo?.full_name !== `${address.owner}/${address.name}`) {
    return undefined;
  }
  if (!body.includes(request.marker)) return undefined;
  if (
    pull.node_id.length > finalizerIdentityCharsMax ||
    !pull.node_id.isWellFormed() ||
    pull.title.length === 0 ||
    pull.title.length > proposalTitleCharsMax ||
    body.length > proposalBodyCharsMax ||
    !pull.title.isWellFormed() ||
    !body.isWellFormed()
  ) {
    return undefined;
  }
  const head = githubChangeProposalsRefOf(pull.head.ref);
  const base = githubChangeProposalsRefOf(pull.base.ref);
  const headCommit = githubChangeProposalsCommitOf(pull.head.sha);
  const baseCommit = githubChangeProposalsCommitOf(pull.base.sha);
  if (head === undefined || base === undefined) return undefined;
  if (headCommit === undefined || baseCommit === undefined) return undefined;
  return {
    identity: {
      forge: request.binding.forge,
      remote: asProposalRemoteIdentity(pull.node_id),
    },
    repository: request.repository,
    marker: request.marker,
    head: { ref: head, commit: headCommit },
    base: { ref: base, commit: baseCommit },
    title: pull.title,
    body,
    status: githubChangeProposalsStatusOf(pull),
    ...githubChangeProposalsUrlOf(pull),
  };
}

/** What one request addresses on this forge, and nothing where this forge addresses no such thing. */
interface GithubProposalTarget {
  readonly address: GithubAddress;
  readonly head: string;
  readonly base: string;
}

function githubChangeProposalsTargetOf(
  own: GithubChangeProposalsState,
  request: ChangeProposalRequest,
): GithubProposalTarget | undefined {
  const address = githubChangeProposalsAddressOf(
    request.repository,
    own.repositoryHost,
  );
  const head = githubChangeProposalsBranchOf(request.head.ref);
  const base = githubChangeProposalsBranchOf(request.base.ref);
  if (address === undefined || head === undefined || base === undefined) {
    return undefined;
  }
  return request.body.includes(request.marker)
    ? { address, head, base }
    : undefined;
}

/** Asks this forge for one pull request, an answer it cannot read leaving the proposal unsettled. */
async function githubChangeProposalsCreate(
  own: GithubChangeProposalsState,
  request: ChangeProposalRequest,
): Promise<ChangeProposalCreated> {
  const target = githubChangeProposalsTargetOf(own, request);
  if (target === undefined) return { created: "Denied" };
  const authorized = await githubChangeProposalsCredentialOf(
    own,
    request.binding,
  );
  if (authorized.authorized === "Refused") {
    return { created: authorized.refusal };
  }
  const answer = await githubChangeProposalsSend(
    own,
    githubChangeProposalsPullsUrl(own, target.address),
    authorized.credential,
    JSON.stringify({
      title: request.title,
      body: request.body,
      head: target.head,
      base: target.base,
    }),
  );
  if (answer.answer === "Denied") return { created: "Denied" };
  if (answer.answer === "Busy") return { created: "Unavailable" };
  if (answer.answer === "Unsettled") return { created: "Ambiguous" };
  const parsed = githubPullRequestSchema.safeParse(answer.body);
  if (!parsed.success) return { created: "Ambiguous" };
  const evidence = githubChangeProposalsEvidenceOf(
    request,
    target.address,
    parsed.data,
  );
  return evidence === undefined
    ? { created: "Ambiguous" }
    : { created: "Created", evidence };
}

/** The collection query one read is, bounded to the proposals a read may consider. */
function githubChangeProposalsReadUrl(
  own: GithubChangeProposalsState,
  target: GithubProposalTarget,
): URL {
  const url = githubChangeProposalsPullsUrl(own, target.address);
  url.searchParams.set("state", "all");
  url.searchParams.set("head", `${target.address.owner}:${target.head}`);
  url.searchParams.set("per_page", String(own.proposalsPerReadMax));
  return url;
}

/** Reads back the proposal on this request's head branch that carries its marker. */
async function githubChangeProposalsRead(
  own: GithubChangeProposalsState,
  request: ChangeProposalRequest,
): Promise<ChangeProposalRead> {
  const target = githubChangeProposalsTargetOf(own, request);
  if (target === undefined) return { read: "Denied" };
  const authorized = await githubChangeProposalsCredentialOf(
    own,
    request.binding,
  );
  if (authorized.authorized === "Refused") return { read: authorized.refusal };
  const answer = await githubChangeProposalsSend(
    own,
    githubChangeProposalsReadUrl(own, target),
    authorized.credential,
    undefined,
  );
  if (answer.answer === "Denied") return { read: "Denied" };
  if (answer.answer !== "Read") return { read: "Unavailable" };
  const parsed = z.array(githubPullRequestSchema).safeParse(answer.body);
  if (!parsed.success) return { read: "Unavailable" };
  for (const pull of parsed.data.slice(0, own.proposalsPerReadMax)) {
    const evidence = githubChangeProposalsEvidenceOf(
      request,
      target.address,
      pull,
    );
    if (evidence !== undefined) return { read: "Found", evidence };
  }
  return { read: "Absent" };
}

/** The adapter over its options, refusing at construction what it could never serve. */
export function githubChangeProposals(
  options: GithubChangeProposalsOptions,
): ChangeProposalPort {
  const own: GithubChangeProposalsState = {
    credentials: options.credentials,
    requestFetch: options.fetch,
    apiHost: githubChangeProposalsHost(
      options.apiHost ?? githubChangeProposalsDefaults.apiHost,
      "the API host",
    ),
    repositoryHost: githubChangeProposalsHost(
      options.repositoryHost ?? githubChangeProposalsDefaults.repositoryHost,
      "the repository host",
    ),
    requestTimeoutSecsMax: githubChangeProposalsBound(
      options.requestTimeoutSecsMax ??
        githubChangeProposalsDefaults.requestTimeoutSecsMax,
      "the request timeout",
    ),
    responseBytesMax: githubChangeProposalsBound(
      options.responseBytesMax ??
        githubChangeProposalsDefaults.responseBytesMax,
      "the response bound",
    ),
    proposalsPerReadMax: githubChangeProposalsBound(
      options.proposalsPerReadMax ??
        githubChangeProposalsDefaults.proposalsPerReadMax,
      "the proposals a read considers",
    ),
  };
  return {
    create: (request) => githubChangeProposalsCreate(own, request),
    readByMarker: (request) => githubChangeProposalsRead(own, request),
  };
}
