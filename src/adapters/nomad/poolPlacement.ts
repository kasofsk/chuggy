/**
 * `WorkerPoolBackend` over one Nomad agent: a batch job per assignment, and
 * nothing that knows what the assignment is for.
 *
 * IT IS THE SAME SEAM THE CLUSTER BACKEND ANSWERS, ON A FABRIC THAT SCHEDULES
 * HOST PROCESSES. A job named for the digest of its assignment, a resource
 * budget the assignment asked for, an envelope carrying a callback and a bearer
 * and no material at all — all of that is the seam's and not this fabric's.
 * What differs is everything `raw_exec` does not do for a workload: there is no
 * image, so the job brings the harness with it; there is no projected secret,
 * so the pool renders one into the task's own private directory; and there is
 * no active deadline, so the deadline the assignment carries becomes the bound
 * the harness holds itself to.
 *
 * WHAT IS RUNNING IS READ FROM THE AGENT. `held` lists this pool's own jobs by
 * their name prefix and reads each assignment off the job's metadata, so a
 * restarted client recovers its workloads instead of orphaning them; a listing
 * that could not be made raises rather than answering an empty agent, because
 * the emptier answer is the one that loses work.
 *
 * A PLACEMENT IS IDEMPOTENT BY ASKING FIRST. Registering a job that already
 * exists is an update rather than a refusal, and an update of a job that
 * already ran would run the same attempt's bearer twice, so a job the agent
 * already holds is reported as placed and left alone.
 *
 * NOMAD DECIDES ASYNCHRONOUSLY AND THIS BACKEND DOES NOT WAIT ON IT. A job
 * document the agent accepted is a placement; whether a node satisfies its
 * constraints is an evaluation made after the answer, so a workload no node can
 * take sits until the orchestrator's own deadline flags it to stop. That is the
 * settled shape of the seam — `Refused` is the document and `Unavailable` is
 * this moment — and a scheduler outcome is neither.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { WorkerPoolAssignment } from "../../contract/workerPool.ts";
import type {
  WorkerPoolBackend,
  WorkerPoolPlacement,
  WorkerPoolStopped,
} from "../../interpreter/workerPoolClient.ts";
import {
  checkedNomadHarnessSource,
  nomadCapabilityConstraint,
  nomadHarnessJob,
  type NomadConstraint,
  type NomadHarnessSource,
  type NomadTemplate,
} from "./harnessJob.ts";
import {
  nomadAnswered,
  nomadDocumentRefusals,
  nomadHeldAssignments,
  nomadJob,
  nomadReach,
  nomadStopJob,
  type NomadAgentSite,
} from "./nomadAgent.ts";

/** The variable the harness reads its envelope from, which every backend writes alike. */
export const nomadPoolTaskVariable = "CHUG_TICKET_WORKER_TASK";

/** The file the pool's provider credential is rendered into, named relative to the task. */
export const nomadPoolCredentialDestination = "secrets/provider-credential";

/**
 * The path the envelope names that file by. The agent expands its own runtime
 * directory into a task's environment values, which is the only way a path
 * decided by the allocation can be named by a document written before it.
 */
export const nomadPoolCredentialPath =
  "${NOMAD_SECRETS_DIR}/provider-credential";

/** How a rendered file is delimited, so no credential's own bytes are read as a template. */
export const nomadPoolTemplateDelimiters = {
  left: "{[{[{",
  right: "}]}]}",
} as const;

/** How many millicores a whole core is, so one conversion is spelled once. */
const nomadMillisPerCore = 1_000;

export interface NomadPoolPlacementConfig extends NomadAgentSite {
  readonly jobNamePrefix: string;
  readonly datacenters: readonly string[];
  /** The node metadata attribute a mapped capability is matched against. */
  readonly capabilityMetaKey: string;
  /** What each capability token requires of a node, an unmapped token requiring nothing. */
  readonly capabilities: Readonly<Record<string, string>>;
  /** What one core of this pool's nodes is worth, which is what turns millicores into Nomad's budget. */
  readonly megahertzPerCore: number;
  readonly source: NomadHarnessSource;
  readonly workspacePath: string;
  readonly timeoutSecsMax: number;
  readonly outputBytesMax: number;
  readonly environment: Readonly<Record<string, string>>;
  /** Where this pool keeps its own provider credential, read per placement and never held. */
  readonly providerCredentialSource?: string | undefined;
}

const nomadJobNamePrefix = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/** Refuses a bound a site stated as something other than a positive whole number. */
function nomadPositive(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return value;
}

export function checkedNomadPoolPlacementConfig(
  config: NomadPoolPlacementConfig,
): NomadPoolPlacementConfig {
  checkedNomadHarnessSource(config.source);
  if (!nomadJobNamePrefix.test(config.jobNamePrefix))
    throw new RangeError("the pool job name prefix is not a Nomad identifier");
  if (config.datacenters.length === 0)
    throw new RangeError("the pool names no datacenter to place work in");
  if (config.capabilityMetaKey.length === 0)
    throw new RangeError("the pool names no node metadata to match against");
  nomadPositive(config.megahertzPerCore, "pool node megahertz per core");
  nomadPositive(config.timeoutSecsMax, "pool workload timeout");
  nomadPositive(config.outputBytesMax, "pool workload output bound");
  nomadPositive(config.requestTimeoutSecsMax, "pool agent request timeout");
  nomadPositive(config.unavailableRetryAfterSecs, "pool backpressure interval");
  nomadPositive(config.heldJobsMax, "pool held job bound");
  if (Object.hasOwn(config.environment, nomadPoolTaskVariable))
    throw new RangeError(
      `pool worker environment may not replace ${nomadPoolTaskVariable}`,
    );
  return config;
}

/** The one job an assignment is placed as, named so a repeated placement names it again. */
export function nomadPoolJobName(
  config: NomadPoolPlacementConfig,
  assignment: string,
): string {
  const digest = createHash("sha256")
    .update(`${String(assignment.length)}:${assignment}`)
    .digest("hex");
  return `${config.jobNamePrefix}-${digest}`;
}

/** The constraints one assignment's capabilities add, an unmapped token adding none. */
function poolPlacementConstraints(
  config: NomadPoolPlacementConfig,
  capabilities: readonly string[],
): readonly NomadConstraint[] {
  const constraints: NomadConstraint[] = [];
  for (const capability of capabilities) {
    const required = config.capabilities[capability];
    if (required === undefined) continue;
    constraints.push(
      nomadCapabilityConstraint(config.capabilityMetaKey, required),
    );
  }
  return constraints;
}

/**
 * What the workload is launched with, which is what no callback can hand it.
 * The deadline the assignment carries bounds the harness itself, because this
 * fabric runs a host process and has no deadline of its own to kill one with.
 */
function poolPlacementEnvelope(
  config: NomadPoolPlacementConfig,
  assignment: WorkerPoolAssignment,
  providerCredentialFile: string | undefined,
): string {
  return JSON.stringify({
    callbackUrl: assignment.callbackUrl,
    bearer: assignment.bearer,
    workspace: config.workspacePath,
    timeoutSecsMax: Math.min(config.timeoutSecsMax, assignment.deadlineSecs),
    outputBytesMax: config.outputBytesMax,
    ...(providerCredentialFile === undefined ? {} : { providerCredentialFile }),
  });
}

/** What this pool could offer a workload of its own credential at this moment. */
type PoolPlacementCredential =
  | { readonly held: "None" }
  | { readonly held: "Held"; readonly template: NomadTemplate }
  | { readonly held: "Unavailable" };

/**
 * The pool's own provider credential, read per placement so a rotated one is
 * picked up without a restart. A credential that cannot be read and one whose
 * bytes the agent would read as a template are both this pool's own state
 * rather than a denial of the contract, so both hold.
 */
async function poolPlacementCredential(
  config: NomadPoolPlacementConfig,
): Promise<PoolPlacementCredential> {
  if (config.providerCredentialSource === undefined) return { held: "None" };
  let contents: string;
  try {
    contents = await readFile(config.providerCredentialSource, "utf8");
  } catch {
    return { held: "Unavailable" };
  }
  if (
    contents.includes(nomadPoolTemplateDelimiters.left) ||
    contents.includes(nomadPoolTemplateDelimiters.right)
  )
    return { held: "Unavailable" };
  return {
    held: "Held",
    template: {
      DestPath: nomadPoolCredentialDestination,
      EmbeddedTmpl: contents,
      Perms: "0600",
      ChangeMode: "noop",
      LeftDelim: nomadPoolTemplateDelimiters.left,
      RightDelim: nomadPoolTemplateDelimiters.right,
    },
  };
}

/** The job document one assignment is registered as, credential and all. */
function poolPlacementJob(
  config: NomadPoolPlacementConfig,
  assignment: WorkerPoolAssignment,
  id: string,
  credential: Extract<PoolPlacementCredential, { held: "None" | "Held" }>,
): Readonly<Record<string, unknown>> {
  const file = credential.held === "Held" ? nomadPoolCredentialPath : undefined;
  return nomadHarnessJob({
    id,
    assignment: assignment.assignment,
    datacenters: config.datacenters,
    constraints: poolPlacementConstraints(config, assignment.capabilities),
    source: config.source,
    environment: {
      ...config.environment,
      [nomadPoolTaskVariable]: poolPlacementEnvelope(config, assignment, file),
    },
    templates: credential.held === "Held" ? [credential.template] : [],
    cpuMegahertz: Math.max(
      1,
      Math.round(
        (assignment.cpuMillis * config.megahertzPerCore) / nomadMillisPerCore,
      ),
    ),
    memoryMib: assignment.memoryMib,
  });
}

/** What this pool answers where the agent described its own state rather than the document. */
function poolPlacementHold(
  config: NomadPoolPlacementConfig,
): WorkerPoolPlacement {
  return {
    placed: "Unavailable",
    retryAfterSecs: config.unavailableRetryAfterSecs,
  };
}

async function poolPlacementPlaced(
  config: NomadPoolPlacementConfig,
  fetcher: typeof fetch,
  assignment: WorkerPoolAssignment,
): Promise<WorkerPoolPlacement> {
  const id = nomadPoolJobName(config, assignment.assignment);
  const existing = await nomadJob(config, fetcher, id);
  if (nomadAnswered(existing)) return { placed: "Placed" };
  if (existing.reached !== "Status" || existing.status !== 404)
    return poolPlacementHold(config);
  const credential = await poolPlacementCredential(config);
  if (credential.held === "Unavailable") return poolPlacementHold(config);
  const registered = await nomadReach(config, fetcher, {
    method: "POST",
    path: "/v1/jobs",
    body: JSON.stringify({
      Job: poolPlacementJob(config, assignment, id, credential),
    }),
  });
  if (nomadAnswered(registered)) return { placed: "Placed" };
  return registered.reached === "Status" &&
    nomadDocumentRefusals.has(registered.status)
    ? {
        placed: "Refused",
        evidence: `the Nomad agent refused this workload document with status ${String(registered.status)}`,
      }
    : poolPlacementHold(config);
}

/**
 * What stopping one assignment came to, which is the agent's answer in the
 * seam's words. A job the agent no longer holds is stopped, and the two
 * inabilities part where every other answer from this agent parts them.
 */
async function poolPlacementStopped(
  config: NomadPoolPlacementConfig,
  fetcher: typeof fetch,
  assignment: string,
): Promise<WorkerPoolStopped> {
  const stopped = await nomadStopJob(
    config,
    fetcher,
    nomadPoolJobName(config, assignment),
  );
  switch (stopped.stopped) {
    case "Accepted":
      return { stopped: "Stopped" };
    case "Refused":
      return {
        stopped: "Refused",
        evidence: `the Nomad agent refused to stop this workload with status ${String(stopped.status)}`,
      };
    case "Unavailable":
      return {
        stopped: "Unavailable",
        evidence: "the Nomad agent could not be reached to stop this workload",
      };
  }
}

export function nomadPoolBackend(
  input: NomadPoolPlacementConfig,
  fetcher: typeof fetch = fetch,
): WorkerPoolBackend {
  const config = checkedNomadPoolPlacementConfig(input);
  return {
    place: (assignment) => poolPlacementPlaced(config, fetcher, assignment),
    stop: (assignment) => poolPlacementStopped(config, fetcher, assignment),
    held: () =>
      nomadHeldAssignments(config, fetcher, `${config.jobNamePrefix}-`),
  };
}
