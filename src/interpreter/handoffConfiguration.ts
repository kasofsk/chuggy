/** Pinned configuration and deterministic rendering for a direct Git handoff. */

import { artifactDigestChars, textCodePointsCount } from "../contract/http.ts";
import type {
  GitObjectId,
  GitRefName,
  HandoffPublicationWitness,
  RepositoryId,
} from "./finalizer.ts";
import type { CanonicalConfiguration } from "./canonicalConfiguration.ts";
import {
  allGitObjectIdChars,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  finalizerIdentityCharsMax,
} from "./finalizer.ts";
import { asArtifactDigest, type ArtifactDigest } from "./resultManifest.ts";

declare const credentialReferenceBrand: unique symbol;
declare const handoffPathBrand: unique symbol;
declare const handoffPathTemplateBrand: unique symbol;
declare const handoffRequestDigestBrand: unique symbol;
declare const handoffConfigurationRevisionBrand: unique symbol;

export type CredentialReference = string & {
  readonly [credentialReferenceBrand]: true;
};
export type HandoffPath = string & { readonly [handoffPathBrand]: true };

/** A path a publication renders its own variables into, proved at readiness to render a `HandoffPath`. */
export type HandoffPathTemplate = string & {
  readonly [handoffPathTemplateBrand]: true;
};

export type HandoffRequestDigest = string & {
  readonly [handoffRequestDigestBrand]: true;
};
export type HandoffConfigurationRevision = string & {
  readonly [handoffConfigurationRevisionBrand]: true;
};

export type HandoffDigestFunction = (canonical: string) => string;

export interface HandoffConfigurationPin {
  readonly revision: HandoffConfigurationRevision;
  readonly digest: ArtifactDigest;
}

export interface UncheckedHandoffConfigurationPin {
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
export const handoffConfigurationRevisionCharsMax = 256;

/** The longest a publication may be given to be witnessed, so a deadline is one. */
export const handoffWitnessProvenWithinSecsMax = 7 * 24 * 60 * 60;

export function asHandoffConfigurationRevision(
  value: string,
): HandoffConfigurationRevision {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > handoffConfigurationRevisionCharsMax ||
    !value.isWellFormed()
  )
    throw new RangeError("handoff configuration revision is not bounded text");
  return value as HandoffConfigurationRevision;
}

export function asHandoffRequestDigest(value: string): HandoffRequestDigest {
  return asArtifactDigest(value) as string as HandoffRequestDigest;
}

export interface HandoffRepositoryRole {
  readonly repository: RepositoryId;
  readonly targetRef: GitRefName;
  readonly credential: CredentialReference;
}

export interface ContainerBuildParameters {
  /** The label the handoff repository files this source under, which is nothing but a path component. */
  readonly sourceRepositoryId: string;
  readonly targetImageRepository: string;
  readonly builderProfile: string;
  readonly platforms: readonly string[];
}

/** The witness a configuration declares, its path a template the publication renders. */
export interface HandoffWitnessTemplate {
  readonly pathTemplate: HandoffPathTemplate;
  readonly provenWithinSecs: number;
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
  readonly destinationPath: HandoffPathTemplate;
  readonly publicationWitness?: HandoffWitnessTemplate;
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
  | "PublicationWitnessInvalid"
  | "OutputBoundInvalid"
  | "ConfigurationPinInvalid";

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
  readonly publicationWitness?: HandoffPublicationWitness;
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
    textCodePointsCount(value) <= handoffParameterCharsMax &&
    value.isWellFormed()
    ? value
    : undefined;
}

function handoffCredential(value: unknown): CredentialReference | undefined {
  const text = handoffBoundedText(value);
  return text === undefined ||
    textCodePointsCount(text) > finalizerIdentityCharsMax
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

/** The one reference namespace this tree writes to, wherever a ref is written. */
export const handoffRefPrefix = "refs/heads/";

/** The one reference-name grammar this tree accepts, wherever a ref is written. */
export function handoffRef(value: unknown): GitRefName | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith(handoffRefPrefix) ||
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
    textCodePointsCount(value) > handoffPathCharsMax ||
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

/** The values a path template is rendered over, which is the whole roster of them. */
export interface HandoffPathValues {
  readonly sourceRepositoryId: string;
  readonly sourceCommit: string;
  readonly requestDigest: string;
}

/** What one variable stands for, and `undefined` where the template named nothing this tree renders. */
function handoffPathValue(
  values: HandoffPathValues,
  name: string,
): string | undefined {
  switch (name) {
    case "sourceRepositoryId":
      return values.sourceRepositoryId;
    case "sourceCommit":
      return values.sourceCommit;
    case "requestDigest":
      return values.requestDigest;
    default:
      return undefined;
  }
}

/**
 * The text a template comes to once its variables stand in it. Every brace must
 * open a variable this roster names and close it, so a misspelled one is
 * refused rather than rendered literally into a path nobody will ever write.
 */
function handoffPathSubstituted(
  template: string,
  values: HandoffPathValues,
): string | undefined {
  const parts: string[] = [];
  let rest = template;
  for (let open = rest.indexOf("{"); open >= 0; open = rest.indexOf("{")) {
    const close = rest.indexOf("}", open);
    const literal = rest.slice(0, open);
    if (close < 0 || literal.includes("}")) return undefined;
    const value = handoffPathValue(values, rest.slice(open + 1, close));
    if (value === undefined) return undefined;
    parts.push(literal, value);
    rest = rest.slice(close + 1);
  }
  return rest.includes("}") ? undefined : [...parts, rest].join("");
}

/**
 * The widest values a publication can ever render, so a template proved here to
 * render a path renders one whatever commit and digest it is later given.
 */
function handoffPathWidest(sourceRepositoryId: string): HandoffPathValues {
  return {
    sourceRepositoryId,
    sourceCommit: "0".repeat(Math.max(...allGitObjectIdChars)),
    requestDigest: "0".repeat(artifactDigestChars),
  };
}

/** Refuses a template that does not render a path this tree writes, at the widest values it will be given. */
function handoffPathTemplate(
  value: unknown,
  sourceRepositoryId: string,
): HandoffPathTemplate | undefined {
  if (typeof value !== "string") return undefined;
  const widest = handoffPathSubstituted(
    value,
    handoffPathWidest(sourceRepositoryId),
  );
  return widest !== undefined && handoffPath(widest) !== undefined
    ? (value as HandoffPathTemplate)
    : undefined;
}

/** Renders one template the readiness already proved, the invariant asserted rather than re-decided. */
function handoffPathRendered(
  template: HandoffPathTemplate,
  values: HandoffPathValues,
): HandoffPath {
  const substituted = handoffPathSubstituted(template, values);
  const rendered =
    substituted === undefined ? undefined : handoffPath(substituted);
  if (rendered === undefined) {
    throw new RangeError(
      "handoff renderer: a pinned template rendered no path",
    );
  }
  return rendered;
}

function handoffWitness(
  value: unknown,
  sourceRepositoryId: string,
): HandoffWitnessTemplate | undefined {
  const record = handoffRecord(value);
  if (record === undefined) return undefined;
  const pathTemplate = handoffPathTemplate(
    record["pathTemplate"],
    sourceRepositoryId,
  );
  const provenWithinSecs = record["provenWithinSecs"];
  if (
    pathTemplate === undefined ||
    !Number.isSafeInteger(provenWithinSecs) ||
    (provenWithinSecs as number) < 1 ||
    (provenWithinSecs as number) > handoffWitnessProvenWithinSecsMax
  )
    return undefined;
  return { pathTemplate, provenWithinSecs: provenWithinSecs as number };
}

function handoffParameters(
  value: unknown,
): ContainerBuildParameters | undefined {
  const record = handoffRecord(value);
  if (record === undefined) return undefined;
  const sourceRepositoryId = handoffBoundedText(record["sourceRepositoryId"]);
  const targetImageRepository = handoffBoundedText(
    record["targetImageRepository"],
  );
  const builderProfile = handoffBoundedText(record["builderProfile"]);
  const platforms = record["platforms"];
  if (
    sourceRepositoryId === undefined ||
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
    sourceRepositoryId,
    targetImageRepository,
    builderProfile,
    platforms: platforms as string[],
  };
}

/** Where one configuration publishes, and what proves the publication was taken up. */
type HandoffDestination = Pick<
  PinnedHandoffConfiguration,
  "destinationPath" | "publicationWitness"
>;

/** What reading both found, so the one path grammar answers for both in one place. */
type HandoffDestinationRead =
  | { readonly read: "Destination"; readonly destination: HandoffDestination }
  | {
      readonly read: "Incomplete";
      readonly fault: HandoffConfigurationFault;
    };

/**
 * Both paths a configuration names, each a template over the values the
 * publication renders and each held to the grammar a written path must satisfy.
 * A configuration declaring no witness is complete without one.
 */
function handoffDestination(
  handoff: Record<string, unknown>,
  parameters: ContainerBuildParameters,
): HandoffDestinationRead {
  const source = parameters.sourceRepositoryId;
  const destinationPath = handoffPathTemplate(
    handoff["destinationPath"],
    source,
  );
  if (destinationPath === undefined)
    return { read: "Incomplete", fault: "DestinationPathInvalid" };
  const declared = handoff["publicationWitness"];
  if (declared === undefined)
    return { read: "Destination", destination: { destinationPath } };
  const publicationWitness = handoffWitness(declared, source);
  return publicationWitness === undefined
    ? { read: "Incomplete", fault: "PublicationWitnessInvalid" }
    : {
        read: "Destination",
        destination: { destinationPath, publicationWitness },
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
  const destination = handoffDestination(handoff, parameters);
  if (destination.read === "Incomplete")
    return { readiness: "Incomplete", fault: destination.fault };
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
      ...destination.destination,
      outputBytesMax: outputBytesMax as number,
    },
  };
}

/** Parses only the immutable revision and digest supplied by the accepted work. */
export function pinnedHandoffConfigurationReadiness(
  canonical: CanonicalConfiguration,
  pin: UncheckedHandoffConfigurationPin,
  digestOf: HandoffDigestFunction,
): HandoffConfigurationReadiness {
  const authored = authoredHandoffConfigurationReadiness(JSON.parse(canonical));
  let checkedPin: HandoffConfigurationPin;
  try {
    checkedPin = {
      revision: asHandoffConfigurationRevision(pin.revision),
      digest: asArtifactDigest(pin.digest),
    };
    if (asArtifactDigest(digestOf(canonical)) !== checkedPin.digest)
      return { readiness: "Incomplete", fault: "ConfigurationPinInvalid" };
  } catch {
    return { readiness: "Incomplete", fault: "ConfigurationPinInvalid" };
  }
  return authored.readiness === "Ready"
    ? {
        readiness: "Ready",
        configuration: { pin: checkedPin, ...authored.configuration },
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

/**
 * The witness this publication must come to hold, at the values the request
 * itself resolved to. It is no part of the identity above: what proves a
 * publication was taken up says nothing about what was published, so raising
 * the deadline must not send the same bytes to a second path.
 */
function handoffPublicationWitness(
  pinned: PinnedHandoffConfiguration,
  values: HandoffPathValues,
): Pick<PublishHandoffRequestConfiguration, "publicationWitness"> {
  const declared = pinned.publicationWitness;
  return declared === undefined
    ? {}
    : {
        publicationWitness: {
          path: handoffPathRendered(declared.pathTemplate, values),
          provenWithinSecs: declared.provenWithinSecs,
        },
      };
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
  const requestDigest = asHandoffRequestDigest(digestOf(identityInput));
  const probeDigest = asHandoffRequestDigest(
    digestOf(`${identityInput.length}:${identityInput}:probe`),
  );
  if (requestDigest === probeDigest)
    throw new RangeError(
      "handoff digest function does not depend on its input",
    );
  const values: HandoffPathValues = {
    sourceRepositoryId: pinned.renderer.parameters.sourceRepositoryId,
    sourceCommit: acceptedWorkCommit,
    requestDigest,
  };
  return {
    kind: "PublishHandoff",
    pin: pinned.pin,
    repository: pinned.handoff,
    acceptedWorkRepository: pinned.work.repository,
    acceptedWorkCommit,
    mode: pinned.mode,
    destinationPath: handoffPathRendered(pinned.destinationPath, values),
    ...handoffPublicationWitness(pinned, values),
    output,
    requestDigest,
  };
}
