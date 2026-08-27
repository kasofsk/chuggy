/**
 * Preparation: what turns one ticket's passed work into a candidate, the
 * durable moves that record it, and the evidence a preparation that failed
 * leaves behind.
 *
 * A HANDOFF IS METADATA UNTIL SOMETHING READS IT. Workers declare path, digest
 * and byte count and store the bytes in attempt-scoped immutable storage, so
 * the finalizer is the first thing in this tree that turns one into a tree
 * object. `HandoffContentPort` is what it reads them through, and it is a
 * second port rather than a method on `ArtifactVerificationPort` because that
 * port is handed a sealed manifest and answers metadata alone — a content
 * method on it would give every holder of a sealed manifest the bytes as well.
 *
 * UNVERIFIED CONTENT CANNOT BECOME A COMMIT, and that is the port's shape
 * rather than a caller's discipline: the only way to obtain bytes is to name
 * the digest they must hash to, and an artifact that hashes to anything else
 * comes back as a refusal with no bytes at all. So there is no ordering a
 * caller can get wrong and no verification it can skip.
 *
 * THE DURABLE AUTHORITY GATHERS ROWS AND DECIDES NOTHING. `handoffRows`
 * answers what the ticket's passed work declared, in path order, and
 * `handoffAccepted` is the pure function that says whether those rows are a
 * candidate's worth of artifacts. Every refusal it returns is deterministic and
 * none of them is retryable, which is what makes them a `PreparationFailed`
 * rather than a hold.
 *
 * A REWORK SUPERSEDES RATHER THAN CONFLICTS. A ticket whose evaluation failed
 * re-runs its work, so a gathering is several spawns deep and the work the
 * evaluations judged is the latest of them; `handoffSuperseded` keeps that
 * spawn's fan-out and drops the rest, so every refusal below reads one spawn's
 * declarations rather than the ticket's whole history. `model/domain.qnt`'s
 * work reduce says the same at its own grain: it overwrites the ticket's
 * artifact mark with what the spawn that just passed produced, so an earlier
 * spawn's output is history and never a second candidate.
 *
 * AN ATTEMPT IS WRITTEN ONCE AND PINS WHAT IT WAS BUILT FROM. The record
 * carries the observed target, the pinned configuration revision and digest,
 * the strategy and the input bundle, under a digest over canonical bytes that
 * bind the attempt to the request it answers. Re-preparation mints another
 * identity, so there is no update path here and none in the schema.
 *
 * LARGE DETAIL STAYS IN THE ARTIFACT AND NOT IN THE ROW. A merge conflict's
 * paths go into a project-owned artifact with its own identity and content
 * digest; the attempt records the two of them and nothing else, which is what
 * keeps the journal and the request row free of a payload that grows with the
 * size of the disagreement.
 *
 * NOTHING HERE READS A CLOCK, A FILESYSTEM OR A REMOTE. The digest arrives as
 * an argument and so do the identities, for the reason `./resultManifest.ts`
 * takes its hash as one: `eslint.config.js` lets this layer name no ambient
 * capability, and a port is the only capability it has.
 */

import { asBoundedText } from "./boundedText.ts";
import type { CanonicalConfiguration } from "./authoring.ts";
import {
  finalizerIdentityCharsMax,
  type CandidateFile,
  type ConflictSummary,
  type FinalizationAttemptId,
  type FinalizationAttemptOutcome,
  type FinalizationClaim,
  type FinalizationFailureKind,
  type GitObjectId,
  type GitRefName,
  type InputBundle,
  type InputBundleId,
  type InputBundleReference,
  type IntegrationStrategy,
  type ObservedTarget,
  type RepositoryId,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import {
  candidateBytesMax,
  candidateExecutionsMax,
  candidateFilesMax,
} from "./finalizer.ts";
import type { AttemptId, ExecutionId } from "./schedulerIdentity.ts";
import type {
  ArtifactDigest,
  ArtifactFailure,
  ArtifactPath,
  ArtifactSite,
  ResultManifestId,
} from "./resultManifest.ts";

declare const projectArtifactIdBrand: unique symbol;
declare const canonicalFinalizationBrand: unique symbol;

/** One project-owned artifact's identity: minted by the finalizer, opaque, never reused. */
export type ProjectArtifactId = string & {
  readonly [projectArtifactIdBrand]: true;
};

/** The bytes a finalization digest is taken over, producible only by this module. */
export type CanonicalFinalization = string & {
  readonly [canonicalFinalizationBrand]: true;
};

/** The hash this module is handed, because its own layer may name no ambient capability. */
export type FinalizationDigestFunction = (
  canonical: CanonicalFinalization,
) => string;

/**
 * The most bytes one conflict manifest's paths are stored at, past which they
 * are truncated. It is a byte count because the artifact is stored as encoded
 * bytes, and a path outside ASCII costs more of them than it has characters.
 */
export const conflictManifestBytesMax = 262_144;

/** The directory no handoff may write into, because git reads it as the repository itself. */
export const handoffReservedDirectory = ".git";

/** The pinned revision's field saying whether a person must approve a candidate before it is promoted. */
export const approvalRequiredField = "finalizationApprovalRequired";

/** Brands an opaque project-owned artifact identity. */
export function asProjectArtifactId(value: string): ProjectArtifactId {
  return asBoundedText(
    value,
    "project artifact",
    finalizerIdentityCharsMax,
  ) as ProjectArtifactId;
}

/** The revision one ticket's work ran under, which its attempt records beside the candidate. */
export interface PinnedConfiguration {
  readonly revision: string;
  readonly digest: string;
}

/**
 * One passed work execution of the ticket, as the durable authority holds it.
 * The canonical configuration is carried so the approval policy is read in this
 * layer rather than by an adapter.
 */
export interface HandoffWork {
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  /** The spawn whose fan-out this execution belongs to, which a rework supersedes whole. */
  readonly spawn: string;
  /** The ticket-local task number, which every later spawn's tasks exceed. */
  readonly task: number;
  readonly manifest: ResultManifestId;
  readonly configuration: PinnedConfiguration;
  readonly canonical: CanonicalConfiguration;
}

/** One declared handoff artifact, named by the attempt whose storage holds its bytes. */
export interface HandoffArtifact {
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly path: ArtifactPath;
  readonly digest: ArtifactDigest;
  readonly bytes: number;
}

/** One immutable Git candidate declared by a passed work execution. */
export interface HandoffSource {
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly repository: RepositoryId;
  readonly ref: GitRefName;
  readonly commit: GitObjectId;
  readonly base: GitObjectId;
  readonly expectedBase: GitObjectId;
}

/** Everything one ticket's passed work declared, gathered before any decision runs. */
export interface HandoffGathering {
  readonly work: readonly HandoffWork[];
  readonly artifacts: readonly HandoffArtifact[];
  readonly sources: readonly HandoffSource[];
}

/** The passed work one finalization promotes, and the revision that work ran under. */
interface TicketHandoffBase {
  readonly manifests: readonly ResultManifestId[];
  readonly configuration: PinnedConfiguration;
  readonly approvalRequired: boolean;
}

/** The one form of authoritative work a finalizer may prepare. */
export type TicketHandoff =
  | (TicketHandoffBase & {
      readonly kind: "Artifacts";
      readonly artifacts: readonly HandoffArtifact[];
    })
  | (TicketHandoffBase & {
      readonly kind: "Source";
      readonly source: HandoffSource;
    });

/**
 * Why one ticket's work cannot become a candidate. Every arm is a property of
 * the rows themselves, so none of them becomes true by waiting.
 */
export type HandoffRefusal =
  | "ConfigurationDisagrees"
  | "ApprovalPolicyUnreadable"
  | "PathIsReserved"
  | "PathIsDeclaredTwice"
  | "TooManyArtifacts"
  | "TooManyBytes"
  | "TooManyExecutions"
  | "SourceDeclaredTwice"
  | "SourceAndArtifactsMixed"
  | "SourceBaseDisagrees";

/** Every refusal, so a suite iterates rather than restates. */
export const allHandoffRefusals: readonly HandoffRefusal[] = [
  "ConfigurationDisagrees",
  "ApprovalPolicyUnreadable",
  "PathIsReserved",
  "PathIsDeclaredTwice",
  "TooManyArtifacts",
  "TooManyBytes",
  "TooManyExecutions",
  "SourceDeclaredTwice",
  "SourceAndArtifactsMixed",
  "SourceBaseDisagrees",
];

/**
 * What reading one ticket's gathered rows found. `NoPassedWork` stands apart
 * from every refusal because it names no configuration revision, and an attempt
 * pinning none is a row the schema will not hold.
 */
export type HandoffAccepted =
  | { readonly accepted: "Handoff"; readonly handoff: TicketHandoff }
  | {
      readonly accepted: "Refused";
      readonly refusal: HandoffRefusal;
      readonly configuration: PinnedConfiguration;
    }
  | { readonly accepted: "NoPassedWork" };

/** Whether the pinned revision asks a person to approve one candidate, or says nothing this module reads. */
function handoffApprovalRequired(
  canonical: CanonicalConfiguration,
): boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const asked = (parsed as Record<string, unknown>)[approvalRequiredField];
  if (asked === undefined) return false;
  return typeof asked === "boolean" ? asked : undefined;
}

/** Whether every passed execution pins the same revision, which one attempt records once. */
function handoffOneConfiguration(work: readonly HandoffWork[]): boolean {
  const first = work[0];
  if (first === undefined) return false;
  return work.every(
    (each) =>
      each.configuration.revision === first.configuration.revision &&
      each.configuration.digest === first.configuration.digest &&
      each.canonical === first.canonical,
  );
}

/** Why the declared paths cannot stand in a tree, or nothing when they can. */
function handoffPathRefusal(
  artifacts: readonly HandoffArtifact[],
): HandoffRefusal | undefined {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.path.split("/")[0] === handoffReservedDirectory) {
      return "PathIsReserved";
    }
    if (seen.has(artifact.path)) return "PathIsDeclaredTwice";
    seen.add(artifact.path);
  }
  return undefined;
}

/** Why the gathered artifacts are not a candidate's worth, or nothing when they are. */
function handoffArtifactRefusal(
  artifacts: readonly HandoffArtifact[],
): HandoffRefusal | undefined {
  if (artifacts.length > candidateFilesMax) return "TooManyArtifacts";
  const bytes = artifacts.reduce((total, each) => total + each.bytes, 0);
  if (bytes > candidateBytesMax) return "TooManyBytes";
  return handoffPathRefusal(artifacts);
}

/**
 * The ticket's authoritative passed work: the latest spawn's fan-out, with
 * every earlier spawn's declarations dropped. A gathering naming no passed work
 * at all is its own answer and comes back untouched.
 */
export function handoffSuperseded(
  gathering: HandoffGathering,
): HandoffGathering {
  const latest = gathering.work.reduce<HandoffWork | undefined>(
    (highest, each) =>
      highest === undefined || each.task > highest.task ? each : highest,
    undefined,
  );
  if (latest === undefined) return gathering;
  const work = gathering.work.filter((each) => each.spawn === latest.spawn);
  const declared = new Set<string>(work.map((each) => each.execution));
  return {
    work,
    artifacts: gathering.artifacts.filter((each) =>
      declared.has(each.execution),
    ),
    sources: gathering.sources.filter((each) => declared.has(each.execution)),
  };
}

/**
 * Whether the gathered rows are a candidate's worth of artifacts, and the
 * deterministic refusal when they are not. It reads nothing and awaits nothing.
 */
export function handoffAccepted(gathering: HandoffGathering): HandoffAccepted {
  const first = gathering.work[0];
  if (first === undefined) return { accepted: "NoPassedWork" };
  const configuration = first.configuration;
  if (gathering.work.length > candidateExecutionsMax) {
    return { accepted: "Refused", refusal: "TooManyExecutions", configuration };
  }
  if (gathering.sources.length > 1) {
    return {
      accepted: "Refused",
      refusal: "SourceDeclaredTwice",
      configuration,
    };
  }
  if (gathering.sources.length > 0 && gathering.artifacts.length > 0) {
    return {
      accepted: "Refused",
      refusal: "SourceAndArtifactsMixed",
      configuration,
    };
  }
  if (gathering.sources.some((source) => source.base !== source.expectedBase)) {
    return {
      accepted: "Refused",
      refusal: "SourceBaseDisagrees",
      configuration,
    };
  }
  const refusal = handoffArtifactRefusal(gathering.artifacts);
  if (refusal !== undefined) {
    return { accepted: "Refused", refusal, configuration };
  }
  if (!handoffOneConfiguration(gathering.work)) {
    return {
      accepted: "Refused",
      refusal: "ConfigurationDisagrees",
      configuration,
    };
  }
  const approvalRequired = handoffApprovalRequired(first.canonical);
  if (approvalRequired === undefined) {
    return {
      accepted: "Refused",
      refusal: "ApprovalPolicyUnreadable",
      configuration,
    };
  }
  return {
    accepted: "Handoff",
    handoff: {
      manifests: [...new Set(gathering.work.map((each) => each.manifest))],
      configuration,
      approvalRequired,
      ...(gathering.sources[0] === undefined
        ? { kind: "Artifacts", artifacts: gathering.artifacts }
        : { kind: "Source", source: gathering.sources[0] }),
    },
  };
}

/** The artifacts one preparation needs the bytes of, inside the project that owns them. */
export interface HandoffRequest {
  readonly partition: Partition;
  readonly artifacts: readonly HandoffArtifact[];
}

/**
 * What reading one ticket's handoff bytes found. `Unavailable` is its own arm
 * rather than a failure, because a storage outage is not evidence about a
 * ticket and folding it in would fabricate finalization failures in an incident.
 */
export type HandoffRead =
  | { readonly read: "Files"; readonly files: readonly CandidateFile[] }
  | {
      readonly read: "Rejected";
      readonly failure: ArtifactFailure;
      readonly at: ArtifactSite;
    }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * Project-owned artifact content, behind a port of its own because
 * `ArtifactVerificationPort` answers metadata alone. Bytes come back only where
 * they hash to the digest the caller pinned, so nothing unverified can be
 * committed.
 */
export interface HandoffContentPort {
  readHandoff(request: HandoffRequest): Promise<HandoffRead>;
}

/** One project-owned artifact a finalization writes, which is where its large evidence lives. */
export interface ProjectArtifactWrite {
  readonly partition: Partition;
  readonly artifact: ProjectArtifactId;
  readonly content: Uint8Array;
}

/** What writing one project-owned artifact came to, its content digest among the answers. */
export type ProjectArtifactWritten =
  | { readonly written: "Artifact"; readonly digest: ArtifactDigest }
  | { readonly written: "Unavailable"; readonly retryAfterSeconds: number };

/** Where a finalization's own evidence is stored, inside the project boundary it was written under. */
export interface ProjectArtifactPort {
  writeArtifact(write: ProjectArtifactWrite): Promise<ProjectArtifactWritten>;
}

/** The identities one preparation mints, drawn together so the pass names no ambient capability. */
export interface PreparationIdentity {
  readonly attempt: FinalizationAttemptId;
  readonly bundle: InputBundleId;
  readonly conflict: ProjectArtifactId;
}

/** Where a preparation's identities come from, which is the composition root and never a clock. */
export interface FinalizerIdentityFactory {
  next(partition: Partition): PreparationIdentity;
}

/**
 * One preparation offered to the durable authority. It is written once, and the
 * schema has no update path at all, so a second preparation is another identity.
 */
export interface AttemptRecord {
  readonly claim: FinalizationClaim;
  readonly repository: RepositoryId;
  readonly attempt: FinalizationAttemptId;
  readonly bundle: InputBundle;
  readonly target: ObservedTarget;
  readonly strategy: IntegrationStrategy;
  readonly configuration: PinnedConfiguration;
  readonly approvalRequired: boolean;
  readonly outcome: FinalizationAttemptOutcome;
  readonly candidate?: GitObjectId;
  readonly failureKind?: FinalizationFailureKind;
  readonly conflictManifest?: ProjectArtifactId;
  readonly conflictDigest?: string;
  readonly attemptDigest: string;
}

/**
 * What recording one preparation did. `Fenced` is every durable reason the row
 * was refused, and none of them is a failure the ticket is told about.
 */
export type AttemptRecorded =
  { readonly recorded: "Attempt" } | { readonly recorded: "Fenced" };

/** One approval asked of a person, naming the prepared attempt the question is about. */
export interface ApprovalAsk {
  readonly claim: FinalizationClaim;
  readonly attempt: FinalizationAttemptId;
}

/** Why no approval was opened, each arm a durable fact the caller reads rather than an error. */
export type ApprovalRefusal =
  "UnknownAttempt" | "BindingMismatch" | "TicketHasAnOpenAction";

/** Every refusal, so a suite iterates rather than restates. */
export const allApprovalRefusals: readonly ApprovalRefusal[] = [
  "UnknownAttempt",
  "BindingMismatch",
  "TicketHasAnOpenAction",
];

/** What asking for one approval found, an ask already standing kept apart from a fresh one. */
export type ApprovalAsked =
  | { readonly asked: "Requested" }
  | { readonly asked: "AlreadyRequested" }
  | { readonly asked: "Refused"; readonly refusal: ApprovalRefusal };

/**
 * The durable moves preparation owns, held apart from the rest of the
 * finalizer's authority because these three are the only ones that write a row
 * a candidate was built from.
 */
export interface FinalizerPreparationStore {
  /**
   * Everything the ticket's passed work declared, gathered before any decision
   * runs, latest spawn first and then in path order so no bound can drop the
   * spawn `handoffSuperseded` keeps.
   */
  handoffGathering(claim: FinalizationClaim): Promise<HandoffGathering>;

  /** Writes the immutable attempt and the bundle it pinned in one transaction, or refuses both. */
  recordAttempt(record: AttemptRecord): Promise<AttemptRecorded>;

  /** Opens the approval one prepared attempt needs, through the one door that may open it. */
  requestApproval(ask: ApprovalAsk): Promise<ApprovalAsked>;
}

/** The label that separates this construction from any other digest this tree computes. */
export const finalizationDigestFormat = "chuggy:finalization:v1";

/** The part that separates a bundle's canonical bytes from an attempt's, which a backfill spells too. */
export const inputBundleCanonicalPart = "bundle";

/** Length-prefixes each part, so no opaque value can spell out a boundary. */
function finalizationParts(parts: readonly string[]): CanonicalFinalization {
  return parts
    .map((part) => `${String(part.length)}:${part}`)
    .join("") as CanonicalFinalization;
}

/** The exact bytes one input bundle's digest is taken over, re-derivable by an auditor. */
export function canonicalInputBundle(
  partition: Partition,
  bundle: InputBundleId,
  references: readonly InputBundleReference[],
): CanonicalFinalization {
  return finalizationParts([
    finalizationDigestFormat,
    inputBundleCanonicalPart,
    partition.tenant,
    partition.project,
    bundle,
    String(references.length),
    ...references.flatMap((reference) => [
      reference.kind,
      reference.reference,
      reference.digest ?? "",
    ]),
  ]);
}

/** The exact bytes one attempt's digest is taken over, binding it to the request it answers. */
export function canonicalFinalizationAttempt(
  record: Omit<AttemptRecord, "attemptDigest">,
): CanonicalFinalization {
  return finalizationParts([
    finalizationDigestFormat,
    "attempt",
    record.claim.partition.tenant,
    record.claim.partition.project,
    record.claim.request,
    String(record.claim.requestGeneration),
    record.attempt,
    record.repository,
    record.bundle.bundle,
    record.bundle.digest,
    record.target.ref,
    record.target.commit,
    record.strategy,
    record.configuration.revision,
    record.configuration.digest,
    String(record.approvalRequired),
    record.outcome,
    record.candidate ?? "",
    record.failureKind ?? "",
    record.conflictManifest ?? "",
    record.conflictDigest ?? "",
  ]);
}

/** One failed automatic integration, structured so a rework bundle can be built from it. */
export interface ConflictManifest {
  readonly request: string;
  readonly attempt: FinalizationAttemptId;
  readonly strategy: IntegrationStrategy;
  readonly candidate: GitObjectId;
  readonly target: ObservedTarget;
  readonly base?: GitObjectId;
  readonly conflict: ConflictSummary;
}

/**
 * The immutable evidence one concluded failure left, read from the attempt the
 * submission pinned. `preparation` is what that attempt's own bundle held, so a
 * rework bundle carries the artifact, handoff and briefing references forward
 * rather than re-deriving them from rows the deciding transaction cannot read.
 */
export interface FinalizationEvidence {
  readonly attempt: FinalizationAttemptId;
  readonly attemptDigest: string;
  readonly targetCommit: GitObjectId;
  readonly conflictManifest?: ProjectArtifactId;
  readonly conflictManifestDigest?: string;
  readonly preparation: readonly InputBundleReference[];
}

/** The schema version a conflict manifest is written at, and the only one this module writes. */
export const conflictManifestSchemaVersion = 1;

/** As many conflicting paths as fit the ceiling, and whether any were left out. */
function conflictManifestPaths(manifest: ConflictManifest): {
  readonly paths: readonly string[];
  readonly truncated: boolean;
} {
  const encoder = new TextEncoder();
  const paths: string[] = [];
  let bytes = 0;
  for (const path of manifest.conflict.paths) {
    bytes += encoder.encode(path).length;
    if (bytes > conflictManifestBytesMax) {
      return { paths, truncated: true };
    }
    paths.push(path);
  }
  return { paths, truncated: manifest.conflict.truncated };
}

/** The exact bytes one conflict manifest is stored and digested as, bounded by its own ceiling. */
export function conflictManifestText(manifest: ConflictManifest): string {
  const held = conflictManifestPaths(manifest);
  return `${JSON.stringify({
    version: conflictManifestSchemaVersion,
    request: manifest.request,
    attempt: manifest.attempt,
    strategy: manifest.strategy,
    candidate: manifest.candidate,
    targetRef: manifest.target.ref,
    targetCommit: manifest.target.commit,
    mergeBase: manifest.base ?? null,
    conflictingPaths: held.paths,
    truncated: held.truncated,
  })}\n`;
}
