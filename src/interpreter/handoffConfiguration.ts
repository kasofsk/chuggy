/** Pinned configuration and deterministic rendering for a direct Git handoff. */

import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  finalizerIdentityCharsMax,
} from "./finalizer.ts";

declare const credentialReferenceBrand: unique symbol;
declare const handoffPathBrand: unique symbol;
declare const handoffRequestDigestBrand: unique symbol;

export type CredentialReference = string & {
  readonly [credentialReferenceBrand]: true;
};
export type HandoffPath = string & { readonly [handoffPathBrand]: true };
export type HandoffRequestDigest = string & {
  readonly [handoffRequestDigestBrand]: true;
};

export type HandoffDigestFunction = (canonical: string) => string;

export interface HandoffConfigurationPin {
  readonly revision: string;
  readonly digest: string;
}

export const handoffConfigurationField = "finalizationHandoff";
export const handoffConfigurationVersion = 1;
export const handoffRendererIdentity = "ContainerBuildRequest";
export const handoffRendererVersion = 1;
export const handoffOutputBytesMaxLimit = 262_144;
export const handoffPlatformsMax = 16;
export const handoffParameterCharsMax = 256;
export const handoffPathCharsMax = 512;

export interface HandoffRepositoryRole {
  readonly repository: RepositoryId;
  readonly targetRef: GitRefName;
  readonly credential: CredentialReference;
}

export interface ContainerBuildParameters {
  readonly targetImageRepository: string;
  readonly builderProfile: string;
  readonly platforms: readonly string[];
}

export interface PinnedHandoffConfiguration {
  readonly pin: HandoffConfigurationPin;
  readonly version: typeof handoffConfigurationVersion;
  readonly mode: "DirectCommit";
  readonly work: HandoffRepositoryRole;
  readonly handoff: HandoffRepositoryRole;
  readonly renderer: {
    readonly identity: typeof handoffRendererIdentity;
    readonly version: typeof handoffRendererVersion;
    readonly parameters: ContainerBuildParameters;
  };
  readonly destinationPath: HandoffPath;
  readonly outputBytesMax: number;
}

export type AuthoredHandoffConfiguration = Omit<
  PinnedHandoffConfiguration,
  "pin"
>;

export type HandoffConfigurationFault =
  | "HandoffShapeMissing"
  | "HandoffVersionUnknown"
  | "HandoffModeUnsupported"
  | "RepositoryRoleInvalid"
  | "RepositoryRoleDuplicated"
  | "CredentialReferenceInvalid"
  | "TargetRefInvalid"
  | "RendererUnknown"
  | "RendererParametersInvalid"
  | "DestinationPathInvalid"
  | "OutputBoundInvalid";

export type HandoffConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: PinnedHandoffConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: HandoffConfigurationFault;
    };

export type AuthoredHandoffConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: AuthoredHandoffConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: HandoffConfigurationFault;
    };

export interface PromoteForHandoffRequestConfiguration {
  readonly kind: "PromoteForHandoff";
  readonly pin: HandoffConfigurationPin;
  readonly repository: HandoffRepositoryRole;
}

export interface PublishHandoffRequestConfiguration {
  readonly kind: "PublishHandoff";
  readonly pin: HandoffConfigurationPin;
  readonly repository: HandoffRepositoryRole;
  readonly acceptedWorkRepository: RepositoryId;
  readonly acceptedWorkCommit: GitObjectId;
  readonly mode: "DirectCommit";
  readonly destinationPath: HandoffPath;
  readonly output: string;
  readonly requestDigest: HandoffRequestDigest;
}

function handoffRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function handoffBoundedText(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= handoffParameterCharsMax &&
    value.isWellFormed()
    ? value
    : undefined;
}

function handoffCredential(value: unknown): CredentialReference | undefined {
  const text = handoffBoundedText(value);
  return text === undefined || text.length > finalizerIdentityCharsMax
    ? undefined
    : (text as CredentialReference);
}

function handoffRefHasInvalidCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || "~^:?*[\\]".includes(character))
      return true;
  }
  return false;
}

function handoffRef(value: unknown): GitRefName | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("refs/heads/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{") ||
    handoffRefHasInvalidCharacter(value) ||
    value
      .split("/")
      .some(
        (part) =>
          part.length === 0 || part.startsWith(".") || part.endsWith(".lock"),
      )
  )
    return undefined;
  try {
    return asGitRefName(value);
  } catch {
    return undefined;
  }
}

function handoffRepositoryRole(
  value: unknown,
  credential: unknown,
): HandoffRepositoryRole | undefined {
  const record = handoffRecord(value);
  const credentialReference = handoffCredential(credential);
  if (record === undefined || credentialReference === undefined)
    return undefined;
  const repository = handoffBoundedText(record["repository"]);
  const targetRef = handoffRef(record["targetRef"]);
  if (repository === undefined || targetRef === undefined) return undefined;
  try {
    return {
      repository: asRepositoryId(repository),
      targetRef,
      credential: credentialReference,
    };
  } catch {
    return undefined;
  }
}

function handoffPath(value: unknown): HandoffPath | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > handoffPathCharsMax ||
    !value.isWellFormed() ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    handoffRefHasInvalidCharacter(value)
  )
    return undefined;
  const parts = value.split("/");
  return parts.some(
    (part) =>
      part.length === 0 || part === "." || part === ".." || part === ".git",
  )
    ? undefined
    : (value as HandoffPath);
}

function handoffParameters(
  value: unknown,
): ContainerBuildParameters | undefined {
  const record = handoffRecord(value);
  if (record === undefined) return undefined;
  const targetImageRepository = handoffBoundedText(
    record["targetImageRepository"],
  );
  const builderProfile = handoffBoundedText(record["builderProfile"]);
  const platforms = record["platforms"];
  if (
    targetImageRepository === undefined ||
    builderProfile === undefined ||
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    platforms.length > handoffPlatformsMax ||
    platforms.some((platform) => handoffBoundedText(platform) === undefined) ||
    new Set(platforms).size !== platforms.length
  )
    return undefined;
  return {
    targetImageRepository,
    builderProfile,
    platforms: platforms as string[],
  };
}

/** Validates the authored handoff shape without resolving any operational binding. */
export function authoredHandoffConfigurationReadiness(
  value: unknown,
): AuthoredHandoffConfigurationReadiness {
  const root = handoffRecord(value);
  const handoff = handoffRecord(root?.[handoffConfigurationField]);
  if (handoff === undefined)
    return { readiness: "Incomplete", fault: "HandoffShapeMissing" };
  if (handoff["version"] !== handoffConfigurationVersion)
    return { readiness: "Incomplete", fault: "HandoffVersionUnknown" };
  if (handoff["mode"] !== "DirectCommit")
    return { readiness: "Incomplete", fault: "HandoffModeUnsupported" };
  const repositories = handoffRecord(handoff["repositories"]);
  const credentials = handoffRecord(handoff["credentials"]);
  if (repositories === undefined)
    return { readiness: "Incomplete", fault: "RepositoryRoleInvalid" };
  if (credentials === undefined)
    return { readiness: "Incomplete", fault: "CredentialReferenceInvalid" };
  const work = handoffRepositoryRole(repositories["work"], credentials["work"]);
  const target = handoffRepositoryRole(
    repositories["handoff"],
    credentials["handoff"],
  );
  if (work === undefined || target === undefined)
    return { readiness: "Incomplete", fault: "RepositoryRoleInvalid" };
  if (work.repository === target.repository)
    return { readiness: "Incomplete", fault: "RepositoryRoleDuplicated" };
  const renderer = handoffRecord(handoff["renderer"]);
  if (
    renderer?.["identity"] !== handoffRendererIdentity ||
    renderer["version"] !== handoffRendererVersion
  )
    return { readiness: "Incomplete", fault: "RendererUnknown" };
  const parameters = handoffParameters(renderer["parameters"]);
  if (parameters === undefined)
    return { readiness: "Incomplete", fault: "RendererParametersInvalid" };
  const destinationPath = handoffPath(handoff["destinationPath"]);
  if (destinationPath === undefined)
    return { readiness: "Incomplete", fault: "DestinationPathInvalid" };
  const outputBytesMax = handoff["outputBytesMax"];
  if (
    !Number.isSafeInteger(outputBytesMax) ||
    (outputBytesMax as number) < 1 ||
    (outputBytesMax as number) > handoffOutputBytesMaxLimit
  )
    return { readiness: "Incomplete", fault: "OutputBoundInvalid" };
  return {
    readiness: "Ready",
    configuration: {
      version: handoffConfigurationVersion,
      mode: "DirectCommit",
      work,
      handoff: target,
      renderer: {
        identity: handoffRendererIdentity,
        version: handoffRendererVersion,
        parameters,
      },
      destinationPath,
      outputBytesMax: outputBytesMax as number,
    },
  };
}

/** Parses only the immutable revision and digest supplied by the accepted work. */
export function pinnedHandoffConfigurationReadiness(
  canonical: string,
  pin: HandoffConfigurationPin,
): HandoffConfigurationReadiness {
  const authored = authoredHandoffConfigurationReadiness(JSON.parse(canonical));
  return authored.readiness === "Ready"
    ? {
        readiness: "Ready",
        configuration: { pin, ...authored.configuration },
      }
    : authored;
}

/** Produces the promotion request without accepting mutable operational configuration. */
export function promoteForHandoffConfiguration(
  pinned: PinnedHandoffConfiguration,
): PromoteForHandoffRequestConfiguration {
  return {
    kind: "PromoteForHandoff",
    pin: pinned.pin,
    repository: pinned.work,
  };
}

function handoffOutput(
  pinned: PinnedHandoffConfiguration,
  acceptedWorkCommit: GitObjectId,
): string {
  const parameters = pinned.renderer.parameters;
  return JSON.stringify({
    apiVersion: "chuggy.dev/v1",
    kind: handoffRendererIdentity,
    spec: {
      builderProfile: parameters.builderProfile,
      platforms: parameters.platforms,
      source: {
        commit: acceptedWorkCommit,
        repository: pinned.work.repository,
      },
      targetImageRepository: parameters.targetImageRepository,
    },
  });
}

function handoffRendererInput(
  pinned: PinnedHandoffConfiguration,
  acceptedWorkCommit: GitObjectId,
): string {
  return JSON.stringify({
    acceptedWorkCommit,
    acceptedWorkRepository: pinned.work.repository,
    parameters: pinned.renderer.parameters,
    rendererIdentity: pinned.renderer.identity,
    rendererVersion: pinned.renderer.version,
  });
}

/** Renders the exact accepted commit and derives the identity of every published effect. */
export function publishHandoffConfiguration(
  pinned: PinnedHandoffConfiguration,
  acceptedWorkCommitValue: string,
  digestOf: HandoffDigestFunction,
): PublishHandoffRequestConfiguration {
  const acceptedWorkCommit = asGitObjectId(acceptedWorkCommitValue);
  const rendererInput = handoffRendererInput(pinned, acceptedWorkCommit);
  const output = handoffOutput(pinned, acceptedWorkCommit);
  if (new TextEncoder().encode(output).byteLength > pinned.outputBytesMax)
    throw new RangeError(
      "handoff renderer: output exceeds its pinned byte bound",
    );
  const identityInput = JSON.stringify({
    destinationPath: pinned.destinationPath,
    handoffMode: pinned.mode,
    handoffRepository: pinned.handoff.repository,
    handoffTargetRef: pinned.handoff.targetRef,
    output,
    outputBytesMax: pinned.outputBytesMax,
    rendererInput,
  });
  return {
    kind: "PublishHandoff",
    pin: pinned.pin,
    repository: pinned.handoff,
    acceptedWorkRepository: pinned.work.repository,
    acceptedWorkCommit,
    mode: pinned.mode,
    destinationPath: pinned.destinationPath,
    output,
    requestDigest: digestOf(identityInput) as HandoffRequestDigest,
  };
}
