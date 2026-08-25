/** Versioned cross-repository build requests rendered from one immutable source. */

import type { CanonicalConfiguration } from "./canonicalConfiguration.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitObjectId,
  type RepositoryId,
} from "./finalizer.ts";
import type { HandoffDigestFunction } from "./handoffConfiguration.ts";
import {
  renderShipwrightBuildRequest,
  shipwrightBuildRequestRenderer,
  type RenderedBuildRequest,
} from "./shipwrightBuildRequest.ts";

export const buildHandoffConfigurationVersion = 2;
export const buildHandoffOutputsMax = 2;
export const buildHandoffOutputBytesMax = 524_288;

export interface BuildHandoffGitRepository {
  readonly repository: RepositoryId;
  readonly targetRef: ReturnType<typeof asGitRefName>;
  readonly credentialReference: string;
}

export interface BuildHandoffSourceGit {
  readonly repository: RepositoryId;
  readonly credentialReference: string;
}

export interface BuildHandoffSourceRepository {
  readonly repositoryId: string;
  readonly url: string;
  readonly buildCredentialReference: string;
}

export type BuildHandoffSource =
  | {
      readonly kind: "AcceptedWork";
      readonly git: BuildHandoffGitRepository;
      readonly build: BuildHandoffSourceRepository;
    }
  | {
      readonly kind: "PinnedSource";
      readonly git: BuildHandoffSourceGit;
      readonly build: BuildHandoffSourceRepository;
    };

export interface BuildHandoffOutput {
  readonly name: string;
  readonly contextDirectory: string;
  readonly dockerfile: string;
  readonly targetImageRepository: string;
}

export interface AuthoredBuildHandoffConfiguration {
  readonly version: typeof buildHandoffConfigurationVersion;
  readonly source: BuildHandoffSource;
  readonly destination: BuildHandoffGitRepository;
  readonly outputCredentialReference: string;
  readonly outputs: readonly BuildHandoffOutput[];
  readonly outputBytesMax: number;
}

export interface PinnedBuildHandoffConfiguration extends AuthoredBuildHandoffConfiguration {
  readonly pin: { readonly revision: string; readonly digest: string };
}

export interface BuildHandoffPromotionConfiguration {
  readonly kind: "PromoteForHandoff";
  readonly pin: PinnedBuildHandoffConfiguration["pin"];
  readonly repository: BuildHandoffGitRepository;
}

export interface BuildHandoffPublicationConfiguration {
  readonly kind: "PublishHandoff";
  readonly pin: PinnedBuildHandoffConfiguration["pin"];
  readonly repository: BuildHandoffGitRepository;
  readonly acceptedWorkRepository: RepositoryId;
  readonly acceptedWorkCommit: GitObjectId;
  readonly outputs: readonly RenderedBuildRequest[];
  readonly requestDigest: string;
}

export interface BuildHandoffDirectConfiguration {
  readonly kind: "RunFinalizer";
  readonly pin: PinnedBuildHandoffConfiguration["pin"];
  readonly repository: BuildHandoffGitRepository;
  readonly sourceRepository: RepositoryId;
  readonly sourceCommit: GitObjectId;
  readonly outputs: readonly RenderedBuildRequest[];
  readonly requestDigest: string;
}

export type BuildHandoffConfigurationFault =
  | "BuildHandoffShapeMissing"
  | "BuildHandoffVersionUnknown"
  | "BuildHandoffSourceInvalid"
  | "BuildHandoffDestinationInvalid"
  | "BuildHandoffOutputInvalid"
  | "BuildHandoffOutputDuplicated"
  | "BuildHandoffOutputBoundInvalid"
  | "BuildHandoffConfigurationPinInvalid";

export type BuildHandoffConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: AuthoredBuildHandoffConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: BuildHandoffConfigurationFault;
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedText(value: unknown, charsMax = 256): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= charsMax &&
    value.isWellFormed()
    ? value
    : undefined;
}

function gitRepository(
  value: unknown,
  credentialValue: unknown,
): BuildHandoffGitRepository | undefined {
  const found = record(value);
  const repository = boundedText(found?.["repository"]);
  const targetRef = boundedText(found?.["targetRef"]);
  const credentialReference = boundedText(credentialValue);
  if (
    repository === undefined ||
    targetRef === undefined ||
    credentialReference === undefined ||
    !targetRef.startsWith("refs/heads/")
  )
    return undefined;
  try {
    return {
      repository: asRepositoryId(repository),
      targetRef: asGitRefName(targetRef),
      credentialReference,
    };
  } catch {
    return undefined;
  }
}

function sourceRepository(
  value: unknown,
  credentialValue: unknown,
): BuildHandoffSourceRepository | undefined {
  const found = record(value);
  const repositoryId = boundedText(found?.["repositoryId"], 63);
  const url = boundedText(found?.["url"], 2_048);
  const buildCredentialReference = boundedText(credentialValue);
  if (
    repositoryId === undefined ||
    url === undefined ||
    buildCredentialReference === undefined ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(repositoryId)
  )
    return undefined;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      return undefined;
  } catch {
    return undefined;
  }
  return { repositoryId, url, buildCredentialReference };
}

function source(
  value: unknown,
  credentials: Record<string, unknown>,
): BuildHandoffSource | undefined {
  const found = record(value);
  const kind = found?.["kind"];
  const build = sourceRepository(found?.["build"], credentials["buildSource"]);
  if (build === undefined) return undefined;
  if (kind === "PinnedSource") {
    const gitValue = record(found?.["git"]);
    const repository = boundedText(gitValue?.["repository"]);
    const credentialReference = boundedText(credentials["sourceGit"]);
    if (repository === undefined || credentialReference === undefined)
      return undefined;
    try {
      return {
        kind,
        git: { repository: asRepositoryId(repository), credentialReference },
        build,
      };
    } catch {
      return undefined;
    }
  }
  const git = gitRepository(found?.["git"], credentials["sourceGit"]);
  return kind === "AcceptedWork" && git !== undefined
    ? { kind, git, build }
    : undefined;
}

function normalizedPath(value: unknown): string | undefined {
  const path = boundedText(value, 512);
  if (path === undefined || path.startsWith("/") || path.includes("\\"))
    return undefined;
  const parts = path.split("/");
  return parts.some(
    (part) => part.length === 0 || part === "." || part === "..",
  )
    ? undefined
    : path;
}

function contextDirectory(value: unknown): string | undefined {
  return value === "." ? "." : normalizedPath(value);
}

function output(value: unknown): BuildHandoffOutput | undefined {
  const found = record(value);
  const name = boundedText(found?.["name"], 63);
  const parsedContextDirectory = contextDirectory(found?.["contextDirectory"]);
  const dockerfile = normalizedPath(found?.["dockerfile"]);
  const targetImageRepository = boundedText(
    found?.["targetImageRepository"],
    512,
  );
  return name === undefined ||
    parsedContextDirectory === undefined ||
    dockerfile === undefined ||
    targetImageRepository === undefined
    ? undefined
    : {
        name,
        contextDirectory: parsedContextDirectory,
        dockerfile,
        targetImageRepository,
      };
}

function outputs(value: unknown): readonly BuildHandoffOutput[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > buildHandoffOutputsMax
  )
    return undefined;
  const parsed = value.map(output);
  return parsed.some((each) => each === undefined)
    ? undefined
    : (parsed as BuildHandoffOutput[]);
}

/** Parses the build-handoff configuration without resolving its source commit. */
export function authoredBuildHandoffConfigurationReadiness(
  value: unknown,
): BuildHandoffConfigurationReadiness {
  const handoff = record(record(value)?.["finalizationHandoff"]);
  if (handoff === undefined)
    return { readiness: "Incomplete", fault: "BuildHandoffShapeMissing" };
  if (handoff["version"] !== buildHandoffConfigurationVersion)
    return { readiness: "Incomplete", fault: "BuildHandoffVersionUnknown" };
  const credentials = record(handoff["credentials"]);
  if (credentials === undefined)
    return { readiness: "Incomplete", fault: "BuildHandoffSourceInvalid" };
  const parsedSource = source(handoff["source"], credentials);
  if (parsedSource === undefined)
    return { readiness: "Incomplete", fault: "BuildHandoffSourceInvalid" };
  const destination = gitRepository(
    handoff["destination"],
    credentials["destinationGit"],
  );
  if (destination === undefined)
    return {
      readiness: "Incomplete",
      fault: "BuildHandoffDestinationInvalid",
    };
  if (
    parsedSource.kind === "AcceptedWork" &&
    parsedSource.git.repository === destination.repository
  )
    return {
      readiness: "Incomplete",
      fault: "BuildHandoffDestinationInvalid",
    };
  const parsedOutputs = outputs(handoff["outputs"]);
  if (parsedOutputs === undefined)
    return { readiness: "Incomplete", fault: "BuildHandoffOutputInvalid" };
  if (
    new Set(parsedOutputs.map((each) => each.name)).size !==
    parsedOutputs.length
  )
    return {
      readiness: "Incomplete",
      fault: "BuildHandoffOutputDuplicated",
    };
  const outputCredentialReference = boundedText(credentials["buildOutput"]);
  const outputBytesMax = handoff["outputBytesMax"];
  if (
    outputCredentialReference === undefined ||
    !Number.isSafeInteger(outputBytesMax) ||
    (outputBytesMax as number) < 1 ||
    (outputBytesMax as number) > buildHandoffOutputBytesMax
  )
    return {
      readiness: "Incomplete",
      fault: "BuildHandoffOutputBoundInvalid",
    };
  return {
    readiness: "Ready",
    configuration: {
      version: buildHandoffConfigurationVersion,
      source: parsedSource,
      destination,
      outputCredentialReference,
      outputs: parsedOutputs,
      outputBytesMax: outputBytesMax as number,
    },
  };
}

/** Adds and verifies the immutable configuration identity a released ticket carries. */
export function pinnedBuildHandoffConfigurationReadiness(
  canonical: CanonicalConfiguration,
  pin: { readonly revision: string; readonly digest: string },
  digestOf: HandoffDigestFunction,
):
  | {
      readonly readiness: "Ready";
      readonly configuration: PinnedBuildHandoffConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: BuildHandoffConfigurationFault;
    } {
  if (digestOf(canonical) !== pin.digest)
    return {
      readiness: "Incomplete",
      fault: "BuildHandoffConfigurationPinInvalid",
    };
  const readiness = authoredBuildHandoffConfigurationReadiness(
    JSON.parse(canonical) as unknown,
  );
  return readiness.readiness === "Incomplete"
    ? readiness
    : {
        readiness: "Ready",
        configuration: { pin, ...readiness.configuration },
      };
}

/** Renders every configured build from the same accepted or pinned source commit. */
export function renderBuildHandoff(
  configuration: PinnedBuildHandoffConfiguration,
  sourceCommitValue: string,
  digestOf: HandoffDigestFunction,
): readonly RenderedBuildRequest[] {
  const sourceCommit: GitObjectId = asGitObjectId(sourceCommitValue);
  const rendered = configuration.outputs.map((each) =>
    renderShipwrightBuildRequest(
      {
        repositoryId: configuration.source.build.repositoryId,
        sourceUrl: configuration.source.build.url,
        sourceCommit,
        sourceCredentialReference:
          configuration.source.build.buildCredentialReference,
        contextDirectory: each.contextDirectory,
        dockerfile: each.dockerfile,
        targetImageRepository: each.targetImageRepository,
        outputCredentialReference: configuration.outputCredentialReference,
      },
      digestOf,
    ),
  );
  const bytes = rendered.reduce(
    (total, each) => total + new TextEncoder().encode(each.content).byteLength,
    0,
  );
  if (bytes > configuration.outputBytesMax)
    throw new RangeError("build handoff output exceeds its pinned byte bound");
  return rendered;
}

/** Produces the accepted-work promotion request before its commit is known. */
export function buildHandoffPromotionConfiguration(
  configuration: PinnedBuildHandoffConfiguration,
): BuildHandoffPromotionConfiguration {
  if (configuration.source.kind !== "AcceptedWork")
    throw new RangeError("build handoff source is not accepted work");
  return {
    kind: "PromoteForHandoff",
    pin: configuration.pin,
    repository: configuration.source.git,
  };
}

/** Binds every rendered output and its destination to one immutable source commit. */
export function buildHandoffPublicationConfiguration(
  configuration: PinnedBuildHandoffConfiguration,
  sourceCommitValue: string,
  digestOf: HandoffDigestFunction,
): BuildHandoffPublicationConfiguration {
  if (configuration.source.kind !== "AcceptedWork")
    throw new RangeError("build handoff publication has no accepted work");
  const acceptedWorkCommit = asGitObjectId(sourceCommitValue);
  const outputs = renderBuildHandoff(
    configuration,
    acceptedWorkCommit,
    digestOf,
  );
  const identity = JSON.stringify({
    acceptedWorkCommit,
    destination: configuration.destination,
    outputs,
    renderer: shipwrightBuildRequestRenderer,
  });
  return {
    kind: "PublishHandoff",
    pin: configuration.pin,
    repository: configuration.destination,
    acceptedWorkRepository: configuration.source.git.repository,
    acceptedWorkCommit,
    outputs,
    requestDigest: digestOf(identity),
  };
}

/** Produces a normal finalization that writes generated files to an external repository. */
export function buildHandoffDirectConfiguration(
  configuration: PinnedBuildHandoffConfiguration,
  sourceCommitValue: string,
  digestOf: HandoffDigestFunction,
): BuildHandoffDirectConfiguration {
  if (configuration.source.kind !== "PinnedSource")
    throw new RangeError("direct build handoff source is not pinned");
  const sourceCommit = asGitObjectId(sourceCommitValue);
  const outputs = renderBuildHandoff(configuration, sourceCommit, digestOf);
  const identity = JSON.stringify({
    destination: configuration.destination,
    outputs,
    renderer: shipwrightBuildRequestRenderer,
    sourceCommit,
    sourceRepository: configuration.source.git.repository,
  });
  return {
    kind: "RunFinalizer",
    pin: configuration.pin,
    repository: configuration.destination,
    sourceRepository: configuration.source.git.repository,
    sourceCommit,
    outputs,
    requestDigest: digestOf(identity),
  };
}
