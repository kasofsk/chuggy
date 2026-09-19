/**
 * The result protocol: what a harness's outcome means, read once and above
 * every backend that could carry it.
 *
 * A HARNESS SUBMITS A NARROW WIRE OUTCOME and nothing else — a manifest with
 * its outputs, or evidence for a failure it could not get past. Everything the
 * machine takes is derived here: the manifest is held to the ticket's own
 * result contract, its reference is minted, an evaluator's verdict is read and
 * the source a work result is to be accepted on is decided. A placement
 * backend that derived any of it would be a second reading of one protocol,
 * and a worker pool this tree did not write cannot be asked to hold the ticket
 * domain at all.
 *
 * A PUBLISHING TASK MUST NAME EXACTLY ONE OUTPUT on the repository it ran
 * against; that commit becomes the source every later cycle and the
 * finalization run from, and an output list that does not say so is a process
 * failure. Findings stay inside the manifest the result reference names,
 * checked for a shape a rework cycle can cite — an unidentified or repeated
 * one reaches the next cycle as evidence nobody can quote.
 */
import { Ajv2020 } from "ajv/dist/2020.js";

import * as evaluation from "../domain/chuggernaut/evaluation.js";
import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import type { TicketContentStore } from "./ticketCatalog.ts";
import { ticketWorkspacePut } from "./ticketWorkspace.ts";

export type TicketExecutionAccess =
  "ReadRepository" | "PublishRepositoryResult";

/** Every terminal a harness may name, and the whole of what one may mean. */
export const ticketExecutionOutcomeTypes = [
  "result",
  "process_failed",
  "execution_unavailable",
] as const;

export type TicketExecutionOutcomeType =
  (typeof ticketExecutionOutcomeTypes)[number];

/** What a harness may say, which carries neither a verdict nor a report. */
export interface TicketExecutionOutcome {
  readonly type: TicketExecutionOutcomeType;
  readonly manifest?: unknown;
  readonly outputs?: unknown;
  readonly evidence?: unknown;
}

/** What deriving a report needs of the attempt's view, and nothing more. */
export interface TicketExecutionOutcomeView {
  readonly resultContract: unknown;
  readonly repository: string;
  readonly commit: string;
  readonly source: task.ContentRef;
  readonly access: TicketExecutionAccess;
}

function ticketExecutionOutcomeRecord(
  value: unknown,
  what: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`ticket execution ${what} must be an object`);
  return value as Record<string, unknown>;
}

function ticketExecutionOutcomeMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

/** The terminal a failed attempt reaches, its evidence minted as this project's content. */
async function ticketExecutionOutcomeFailed(
  content: TicketContentStore,
  held: task.TaskId,
  evidence: string,
  kind: ticket.FailureKind,
): Promise<ticket.TerminalFailureReport> {
  return new ticket.TerminalFailureReport(
    task.task_owner(held),
    new task.TaskFailure(held, await content.put("text/plain", evidence)),
    kind,
  );
}

/** An evaluator's manifest says pass or fail, and a passing one may hold no findings. */
export function ticketExecutionVerdict(
  manifest: Record<string, unknown>,
): evaluation.EvaluationVerdict {
  const verdict = Object.hasOwn(manifest, "verdict")
    ? manifest["verdict"]
    : "pass";
  if (!["pass", "passed", "fail", "failed"].includes(String(verdict)))
    throw new TypeError("ticket execution manifest verdict is invalid");
  const findings = ticketExecutionVerdictFindings(manifest);
  const passed = verdict === "pass" || verdict === "passed";
  if (passed && findings > 0)
    throw new TypeError("a passing evaluator manifest cannot contain findings");
  return passed
    ? new evaluation.EvaluatorPass()
    : new evaluation.EvaluatorFail();
}

/** Counts the findings a manifest declares, refusing a malformed list. */
function ticketExecutionVerdictFindings(
  manifest: Record<string, unknown>,
): number {
  const raw = manifest["findings"] ?? [];
  if (!Array.isArray(raw))
    throw new TypeError("ticket execution findings are invalid");
  const seen = new Set<number>();
  for (const [offset, entry] of raw.entries()) {
    const finding = ticketExecutionOutcomeRecord(entry, "finding");
    const description = finding["description"];
    if (typeof description !== "string" || description.length === 0)
      throw new TypeError("ticket execution finding description is invalid");
    const identifier =
      typeof finding["id"] === "number" && Number.isInteger(finding["id"])
        ? finding["id"]
        : offset + 1;
    if (identifier <= 0)
      throw new TypeError("ticket execution finding identity is invalid");
    if (seen.has(identifier))
      throw new TypeError("ticket execution finding identity is repeated");
    seen.add(identifier);
  }
  return raw.length;
}

/**
 * The source the machine is to accept for a work result: a publishing task's
 * one output, or the source a non-publishing task never moved off.
 */
/**
 * Holds a published output to the commit the attempt was served. It refuses a
 * base that diverged rather than proving one, exactly as the constraint it
 * restores did: a harness states what it branched from and the plane refuses a
 * statement that disagrees with what it handed out.
 */
function ticketExecutionOutcomeBase(
  view: TicketExecutionOutcomeView,
  offered: unknown,
): void {
  if (typeof offered !== "string")
    throw new TypeError(
      "ticket execution output must name the base it built on",
    );
  if (offered.toLowerCase() !== view.commit.toLowerCase())
    throw new TypeError(
      "ticket execution output base is not the commit the attempt was served",
    );
}

async function ticketExecutionOutcomeSource(
  content: TicketContentStore,
  view: TicketExecutionOutcomeView,
  raw: unknown,
): Promise<task.ContentRef> {
  if (!Array.isArray(raw))
    throw new TypeError("ticket execution outputs must be an array");
  if (view.access === "ReadRepository") {
    if (raw.length !== 0)
      throw new TypeError("read-only ticket execution produced an output");
    return view.source;
  }
  if (raw.length !== 1)
    throw new TypeError("publishing ticket execution must produce one output");
  const output = ticketExecutionOutcomeRecord(raw[0], "output");
  if (output["repository"] !== view.repository)
    throw new TypeError("ticket execution output repository is invalid");
  const commit = output["commit"];
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit))
    throw new TypeError("ticket execution output commit is invalid");
  ticketExecutionOutcomeBase(view, output["base"]);
  return ticketWorkspacePut(content, {
    repository: view.repository,
    commit: commit.toLowerCase(),
  });
}

/** The report a validated manifest becomes, which the kind of task decides. */
async function ticketExecutionOutcomeProduced(
  content: TicketContentStore,
  obligation: task.TaskObligation,
  view: TicketExecutionOutcomeView,
  manifest: Record<string, unknown>,
  outputs: unknown,
): Promise<ticket.WorkResultReport | ticket.EvaluationResultReport> {
  const resultRef = await content.put(
    "application/json",
    JSON.stringify(manifest),
  );
  const owner = task.task_owner(obligation.task);
  const result = task.ValidatedTaskResult.produce(obligation, resultRef);
  return obligation.task instanceof task.EvaluationTaskId
    ? new ticket.EvaluationResultReport(
        owner,
        result,
        ticketExecutionVerdict(manifest),
      )
    : new ticket.WorkResultReport(
        owner,
        result,
        await ticketExecutionOutcomeSource(content, view, outputs),
      );
}

/** Holds a workload's manifest to the ticket's own result contract. */
function ticketExecutionOutcomeManifest(
  view: TicketExecutionOutcomeView,
  offered: unknown,
): Record<string, unknown> {
  const manifest = ticketExecutionOutcomeRecord(offered, "result");
  const validate = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
  }).compile(
    ticketExecutionOutcomeRecord(view.resultContract, "result contract"),
  );
  if (!validate(manifest))
    throw new TypeError(
      `result contract violation: ${validate.errors?.[0]?.message ?? "invalid result"}`,
    );
  return manifest;
}

/** How an unreadable type is quoted back, bounded because a harness wrote it. */
function ticketExecutionOutcomeNamed(type: unknown): string {
  return typeof type === "string"
    ? JSON.stringify(type.slice(0, 64))
    : typeof type;
}

/**
 * The wire outcome a harness submitted, held to the terminals this protocol
 * knows. A type outside them is named rather than folded into whichever failure
 * it most resembles, because a harness reporting a terminal this tree cannot
 * read is a different fact from a workload that failed.
 */
function ticketExecutionOutcomeParsed(raw: unknown): TicketExecutionOutcome {
  const record = ticketExecutionOutcomeRecord(raw, "worker outcome");
  const type = record["type"];
  if (
    typeof type !== "string" ||
    !(ticketExecutionOutcomeTypes as readonly string[]).includes(type)
  )
    throw new TypeError(
      `ticket execution outcome type is unrecognised: ${ticketExecutionOutcomeNamed(type)}`,
    );
  return {
    type: type as TicketExecutionOutcomeType,
    manifest: record["manifest"],
    outputs: record["outputs"],
    evidence: record["evidence"],
  };
}

/**
 * The terminal one wire outcome means. A manifest this protocol cannot read is
 * a process failure rather than a refusal: the attempt ran, and what it left
 * behind is what the next cycle has to be told about.
 */
export async function ticketExecutionOutcomeReport(
  content: TicketContentStore,
  obligation: task.TaskObligation,
  view: TicketExecutionOutcomeView,
  raw: unknown,
): Promise<ticket.TaskTerminalReport> {
  const held = obligation.task;
  let outcome: TicketExecutionOutcome;
  try {
    outcome = ticketExecutionOutcomeParsed(raw);
  } catch (error) {
    return ticketExecutionOutcomeFailed(
      content,
      held,
      ticketExecutionOutcomeMessage(error, "worker outcome is invalid"),
      new ticket.ProcessFailure(),
    );
  }
  if (outcome.type === "result")
    return ticketExecutionOutcomeResult(content, obligation, view, outcome);
  const evidence =
    typeof outcome.evidence === "string"
      ? outcome.evidence
      : "ticket worker returned an invalid outcome";
  return ticketExecutionOutcomeFailed(
    content,
    held,
    evidence,
    outcome.type === "execution_unavailable"
      ? new ticket.ExecutionUnavailableFailure()
      : new ticket.ProcessFailure(),
  );
}

async function ticketExecutionOutcomeResult(
  content: TicketContentStore,
  obligation: task.TaskObligation,
  view: TicketExecutionOutcomeView,
  outcome: TicketExecutionOutcome,
): Promise<ticket.TaskTerminalReport> {
  try {
    return await ticketExecutionOutcomeProduced(
      content,
      obligation,
      view,
      ticketExecutionOutcomeManifest(view, outcome.manifest),
      outcome.outputs,
    );
  } catch (error) {
    return ticketExecutionOutcomeFailed(
      content,
      obligation.task,
      ticketExecutionOutcomeMessage(error, "workload result is invalid"),
      new ticket.ProcessFailure(),
    );
  }
}
