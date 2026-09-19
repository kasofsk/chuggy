/**
 * How a pool reaches its Nomad agent: one bounded request, the job operations a
 * placement is made of, and what each answer means for the assignment it was
 * made for.
 *
 * EVERY REACH IS BOUNDED AND EVERY OUTCOME IS A VALUE. One request carries one
 * deadline, nothing retries in place — the pass above decides when to try
 * again — and an agent that refuses, that cannot be reached, or that answers
 * something this module does not recognise is an arm of a placement outcome
 * rather than a raised failure.
 *
 * THE TWO INABILITIES PART AT THE STATUS LINE, AND AN ANSWER THIS MODULE DOES
 * NOT RECOGNISE IS A HOLD. Only a refusal of the submitted document itself is
 * the site declining to run this contract. A token the agent would not accept
 * is not: one status line cannot tell an expired ACL, a cluster with no leader
 * and a policy short of the submit-job capability apart, and every one of those
 * resolves without anyone touching the durable row. So every other answer
 * describes the cluster's own state at this moment and holds.
 *
 * A TOKEN IS READ PER ACT AND NEVER HELD. The token file is what the site
 * carries, so a rotated token is picked up without a restart and no credential
 * is ever an argument, a diagnostic or a stored value; a token that cannot be
 * read is a hold like an unreachable agent.
 *
 * WHAT IS RUNNING IS READ FROM THE AGENT AND NOT FROM A JOB NAME. A job is
 * named for the digest of its assignment, which is what makes a repeated
 * placement idempotent and a stop addressable, and it carries the assignment
 * itself in its metadata, which is what a restarted client reads back. A
 * listing that ran past its bound raises rather than answering a short list,
 * because the shorter answer is the one that orphans work.
 */

import { readFile } from "node:fs/promises";

/** How many milliseconds a configured second is, so one deadline is spelled once. */
const millisecondsPerSecond = 1_000;

/** The metadata key one job carries its assignment in, which is what `held` reads back. */
export const nomadAssignmentMeta = "chug_assignment";

/** What one reach of the agent API found, an outage never reading as an answer. */
export type NomadReached =
  | {
      readonly reached: "Status";
      readonly status: number;
      readonly body: string;
      readonly nextPageToken: string;
    }
  | { readonly reached: "Unreachable" };

/** One request this adapter makes, under the deadline every reach has. */
export interface NomadReach {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: string;
}

/** What this deployment needs to address one agent, and how long it waits on it. */
export interface NomadAgentSite {
  readonly apiBaseUrl: string;
  readonly tokenFile?: string | undefined;
  readonly namespace?: string | undefined;
  readonly requestTimeoutSecsMax: number;
  readonly unavailableRetryAfterSecs: number;
  readonly heldJobsMax: number;
}

/** The address one reach is made to, the namespace travelling as the agent expects it. */
function nomadReachUrl(site: NomadAgentSite, path: string): URL {
  const url = new URL(path, site.apiBaseUrl);
  if (site.namespace !== undefined)
    url.searchParams.set("namespace", site.namespace);
  return url;
}

/** Reaches the agent API once, under this deployment's deadline and its current token. */
export async function nomadReach(
  site: NomadAgentSite,
  fetcher: typeof fetch,
  reach: NomadReach,
): Promise<NomadReached> {
  try {
    const token =
      site.tokenFile === undefined
        ? undefined
        : (await readFile(site.tokenFile, "utf8")).trim();
    const response = await fetcher(nomadReachUrl(site, reach.path), {
      method: reach.method,
      signal: AbortSignal.timeout(
        site.requestTimeoutSecsMax * millisecondsPerSecond,
      ),
      headers: {
        accept: "application/json",
        ...(token === undefined ? {} : { "x-nomad-token": token }),
        ...(reach.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(reach.body === undefined ? {} : { body: reach.body }),
    });
    return {
      reached: "Status",
      status: response.status,
      body: await response.text(),
      nextPageToken: response.headers.get("x-nomad-nexttoken") ?? "",
    };
  } catch {
    return { reached: "Unreachable" };
  }
}

/** The answers that refuse the submitted document itself rather than describe the cluster. */
export const nomadDocumentRefusals: ReadonlySet<number> = new Set([
  400, 413, 415, 422,
]);

/** Whether the agent answered this reach at all, which both its success lines say. */
export function nomadAnswered(reached: NomadReached): boolean {
  return (
    reached.reached === "Status" &&
    (reached.status === 200 || reached.status === 204)
  );
}

/** The document one answer carried, or nothing where the agent did not answer with one. */
export function nomadDocument(reached: NomadReached): unknown {
  if (!nomadAnswered(reached) || reached.reached !== "Status") return undefined;
  try {
    return JSON.parse(reached.body) as unknown;
  } catch {
    return undefined;
  }
}

/** One job as this adapter reads it back, which is its status and the assignment it holds. */
export interface NomadHeldJob {
  readonly id: string;
  readonly assignment: string;
  readonly dead: boolean;
}

/** What one job document says about itself, of which this adapter reads three members. */
function nomadReadJob(document: unknown): NomadHeldJob | undefined {
  if (document === null || typeof document !== "object") return undefined;
  const job = document as {
    readonly ID?: unknown;
    readonly Status?: unknown;
    readonly Meta?: Readonly<Record<string, unknown>> | null;
  };
  const assignment = job.Meta?.[nomadAssignmentMeta];
  if (
    typeof job.ID !== "string" ||
    typeof assignment !== "string" ||
    assignment.length === 0
  )
    return undefined;
  return { id: job.ID, assignment, dead: job.Status === "dead" };
}

/** Reads one named job, which is how a placement learns the agent already holds it. */
export async function nomadJob(
  site: NomadAgentSite,
  fetcher: typeof fetch,
  id: string,
): Promise<NomadReached> {
  return nomadReach(site, fetcher, {
    method: "GET",
    path: `/v1/job/${encodeURIComponent(id)}`,
  });
}

/** The identifiers one listing page named, whichever of them this pool owns. */
function nomadListedIds(document: unknown, prefix: string): readonly string[] {
  if (!Array.isArray(document)) return [];
  const named: string[] = [];
  for (const item of document) {
    if (item === null || typeof item !== "object") continue;
    const id = (item as { readonly ID?: unknown }).ID;
    if (typeof id === "string" && id.startsWith(prefix)) named.push(id);
  }
  return named;
}

/**
 * Every job this pool named, read page by page under a bound it will not go
 * past. A listing that could not be made and one that ran past its bound both
 * raise, because the shorter answer means this pool holds nothing and that is
 * the answer which orphans work.
 */
export async function nomadListedJobIds(
  site: NomadAgentSite,
  fetcher: typeof fetch,
  prefix: string,
): Promise<readonly string[]> {
  const named: string[] = [];
  let page = "";
  for (let read = 0; read <= site.heldJobsMax; read += 1) {
    const reached = await nomadReach(site, fetcher, {
      method: "GET",
      path: `/v1/jobs?prefix=${encodeURIComponent(prefix)}${page === "" ? "" : `&next_token=${encodeURIComponent(page)}`}`,
    });
    const document = nomadDocument(reached);
    if (document === undefined)
      throw new Error("the Nomad agent could not be listed");
    named.push(...nomadListedIds(document, prefix));
    page = reached.reached === "Status" ? reached.nextPageToken : "";
    if (page === "" || named.length > site.heldJobsMax) break;
  }
  if (named.length > site.heldJobsMax)
    throw new Error("this pool named more jobs than it can account for");
  return named;
}

/**
 * The assignments this pool is still running, read back out of the agent. A job
 * the agent calls dead is not one of them: its harness has already reported its
 * own terminal, and holding it would renew a lease over finished work.
 */
export async function nomadHeldAssignments(
  site: NomadAgentSite,
  fetcher: typeof fetch,
  prefix: string,
): Promise<readonly string[]> {
  const held: string[] = [];
  for (const id of await nomadListedJobIds(site, fetcher, prefix)) {
    const reached = await nomadJob(site, fetcher, id);
    if (reached.reached === "Status" && reached.status === 404) continue;
    const job = nomadReadJob(nomadDocument(reached));
    if (job === undefined)
      throw new Error("the Nomad agent named a job this pool cannot read");
    if (!job.dead) held.push(job.assignment);
  }
  return held;
}

/**
 * Stops one named job and takes it out of the agent's own record of itself. A
 * job that is gone and a job that has just been asked to go are the same
 * answer, because the caller's question is whether the agent still holds one.
 */
export async function nomadStopJob(
  site: NomadAgentSite,
  fetcher: typeof fetch,
  id: string,
): Promise<
  { readonly stopped: "Accepted" } | { readonly stopped: "Unavailable" }
> {
  const reached = await nomadReach(site, fetcher, {
    method: "DELETE",
    path: `/v1/job/${encodeURIComponent(id)}?purge=true`,
  });
  if (reached.reached === "Status" && reached.status === 404)
    return { stopped: "Accepted" };
  return nomadAnswered(reached)
    ? { stopped: "Accepted" }
    : { stopped: "Unavailable" };
}
