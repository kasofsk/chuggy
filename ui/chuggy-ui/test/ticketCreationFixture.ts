/**
 * One draft initialization and the forms built from it, shared by the suites
 * that check what a creation screen decides and what it sends.
 *
 * The values are the wire's own shapes, so a schema that gains a field fails
 * here rather than in one suite that happened to be updated.
 */

import { bootstrapConfigurationName } from "../../../src/contract/responses.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryResponse,
} from "../../../src/contract/responses.ts";
import type { BriefFinalizationMode } from "../../../src/contract/rosters.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  creationConfigurationName,
  creationFormFrom,
} from "../app/core/ticketCreation.ts";
import type {
  CreationOffer,
  TicketCreationForm,
} from "../app/core/ticketCreation.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Answer, Sent } from "./answeringApi.ts";
import { ticketInstants } from "./ticketInstants.ts";

export const creationDigest = "a".repeat(64);

export const creationPartition = { tenant: "acme", project: "atlas" };

export function creationSummary(
  revision: string,
  readiness: "Ready" | "Incomplete",
): ConfigurationSummary {
  const base = {
    revision,
    digest: creationDigest,
    createdAt: "2026-08-26T00:00:00Z",
    provenance: { source: "Authored" as const },
  };
  return readiness === "Incomplete"
    ? { ...base, readiness }
    : {
        ...base,
        readiness,
        image: "an-image",
        practices: [],
        workInstructionsCount: 1,
        reviewInstructionsCount: 1,
        finalization: { approvalRequired: false },
        evaluationStagesCount: 1,
      };
}

/** The commit a declared fixture row is imported at unless a case says another. */
export const creationCommit = "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23";

/** A revision one repository declares under a name, at one commit. */
export function creationDeclared(
  revision: string,
  repository: string,
  name: string,
  readiness: "Ready" | "Incomplete" = "Ready",
  commit = creationCommit,
): ConfigurationSummary {
  const provenance: ConfigurationSummary["provenance"] = {
    source: "Repository",
    repository,
    commit,
    path: `configurations/${name}.json`,
    name,
  };
  return { ...creationSummary(revision, readiness), provenance };
}

export const creationInitialization: DraftInitializationResponse = {
  configuration: {
    partition: creationPartition,
    revision: "r3",
    canonical: "{}",
    digest: creationDigest,
  },
  fence: { projectSequence: 41, configurationDigest: creationDigest },
  defaults: {
    dependencies: [],
    program: [{ key: 1, evaluators: [{ key: 1 }] }],
  },
  choices: {
    programStagesMax: 2,
    evaluatorsMax: 3,
  },
  dependencyCandidates: [7, 8],
  dependencyCandidatesTruncated: false,
};

export const creationDraft: DraftResponse = {
  partition: creationPartition,
  ticket: 12,
  authoringVersion: 3,
  state: "Draft",
  configurationRevision: "r3",
  authoring: creationInitialization.defaults,
};

/** The fixture's draft as its door answers a revision of it. */
export function creationDraftRevised(
  configurationRevision = creationDraft.configurationRevision,
): Answer {
  return {
    status: 200,
    body: {
      ...creationDraft,
      authoringVersion: creationDraft.authoringVersion + 1,
      configurationRevision,
    },
  };
}

function creationOperation(state: "Refused" | "Succeeded"): unknown {
  const accepted = { operation: "op", acceptedAt: "2026-08-26T00:00:00Z" };
  return state === "Succeeded"
    ? { ...accepted, state, decidedSequence: 42 }
    : {
        ...accepted,
        state,
        code: "ConfigurationInvalid",
        refusedHead: 41,
        refusedLifecycleGeneration: 1,
      };
}

/**
 * An API over one draft a release leaves held: it creates the fixture's
 * draft, refuses the first release sent and carries out each one after, and
 * answers a revision of the draft as the case says.
 */
export function creationApiRefusingFirst(revised: () => Answer): {
  readonly ports: ApiPorts;
  readonly sent: Sent[];
} {
  const released = { count: 0 };
  return answeringApi((method, path) => {
    if (method === "PUT") return revised();
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: creationDraft };
    if (method === "POST") {
      released.count += 1;
      return { status: 202, body: { operation: "op", state: "Pending" } };
    }
    if (path.includes("/operations/"))
      return {
        status: 200,
        body: creationOperation(released.count > 1 ? "Succeeded" : "Refused"),
      };
    return {
      status: 200,
      body: {
        partition: creationPartition,
        sequence: 42,
        tickets: [
          {
            ticket: creationDraft.ticket,
            phase: "Pending",
            sequence: 42,
            ...ticketInstants,
          },
        ],
      },
    };
  });
}

/** One binding as the listing answers it, whose landing is what a form seeded
 * from it starts on. */
export function creationBinding(
  repository: string,
  mode: BriefFinalizationMode = "Push",
  retiredAt?: string,
): ProjectRepositoryResponse {
  return {
    repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode },
    ...(retiredAt === undefined ? {} : { retiredAt }),
  };
}

/**
 * One binding beside what the project holds for its repository, as the
 * listing answers it: the names it declared, the bootstrap, or nothing.
 */
export function creationListed(
  binding: ProjectRepositoryResponse,
  held?: "Imported" | "Bootstrapped",
): ProjectRepositoryListedResponse {
  if (held === undefined) return { ...binding, configured: false };
  return {
    ...binding,
    configured: true,
    configurationsHeld:
      held === "Imported"
        ? { result: "Imported", count: 2 }
        : { result: "Bootstrapped", revision: bootstrapConfigurationName },
  };
}

/**
 * One listed revision as an offer: the fixture's initialization under that
 * revision, with whatever a case says its configuration decides differently.
 */
export function creationOffer(
  listed: ConfigurationSummary = creationSummary("r3", "Ready"),
  over: Partial<DraftInitializationResponse> = {},
): CreationOffer {
  return {
    name: creationConfigurationName(listed),
    listed,
    initialization: {
      ...creationInitialization,
      ...over,
      configuration: {
        ...creationInitialization.configuration,
        revision: listed.revision,
        ...(listed.version === undefined ? {} : { version: listed.version }),
      },
    },
  };
}

/** What a project offering one configuration offers, which is every case's
 * but the choice's own. */
export const creationOffers: readonly CreationOffer[] = [creationOffer()];

export function creationForm(
  over: Partial<TicketCreationForm> = {},
  repositories: readonly ProjectRepositoryResponse[] = [],
): TicketCreationForm {
  return {
    ...creationFormFrom(creationOffers, repositories),
    intent: "ship it",
    ...over,
  };
}

/** The YAML a browser kept while its project offered one configuration, and
 * so drew no key for it, as it stands once the project offers several. */
export const creationYamlKeptUnasked =
  'title: Ship it\nintent: |-\n  do it\nlinks: []\nbranch: ""\nlanding: Push\ntarget: ""\ndependencies: [ 7 ]\nprogram:\n  - evaluators: 2\n  - evaluators: 1\n';
