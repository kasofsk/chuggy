/**
 * One draft initialization and the forms built from it, shared by the suites
 * that check what a creation screen decides and what it sends.
 *
 * The values are the wire's own shapes, so a schema that gains a field fails
 * here rather than in one suite that happened to be updated.
 */

import { bootstrapConfigurationRevisionPrefix } from "../../../src/contract/responses.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryResponse,
} from "../../../src/contract/responses.ts";
import type { BriefFinalizationMode } from "../../../src/contract/rosters.ts";
import { configurationCatalogInitialization } from "../app/core/configurationCatalog.ts";
import {
  creationConfigurationName,
  creationFormFrom,
} from "../app/core/ticketCreation.ts";
import type {
  CreationOffer,
  TicketCreationForm,
} from "../app/core/ticketCreation.ts";
import type { TicketCreationRequest } from "../app/core/ticketCreationRun.ts";

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

/**
 * A project's listing, answered by path, in which `repository` is found only
 * by its newest revisions: every revision is page after page of another
 * repository's imports, past any budget, and the newest of each name is one
 * page holding this repository's newest commit, the other repository, and a
 * name an older commit declared and the newest dropped.
 */
export function creationHistoryDeep(
  repository: string,
  other: string,
): (path: string) => unknown {
  let pages = 0;
  return (path) => {
    if (path.includes("latest=true"))
      return {
        configurations: [
          creationDeclared("d-sonnet", repository, "development-sonnet"),
          creationDeclared("d-development", repository, "development"),
          creationDeclared("x-other", other, "other"),
          creationDeclared(
            "d-dropped",
            repository,
            "dropped",
            "Ready",
            "0b5c1d0",
          ),
        ],
      };
    pages += 1;
    return {
      configurations: Array.from({ length: 50 }, (_, row) =>
        creationDeclared(`x-${String(pages)}-${String(row)}`, other, "other"),
      ),
      nextCursor: "more",
    };
  };
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

/** What a form over that initialization creates its draft with, saying the
 * least a form may. */
export const creationBody: TicketCreationRequest["body"] = {
  configurationRevision: creationInitialization.configuration.revision,
  configurationDigest: creationInitialization.fence.configurationDigest,
  expectedProjectSequence: creationInitialization.fence.projectSequence,
  authoring: creationInitialization.defaults,
  brief: { intent: "ship it", links: [] },
};

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
    pipelinesWritable: false,
    ...(retiredAt === undefined ? {} : { retiredAt }),
  };
}

/**
 * A stand-in for the revision a repository's bootstrap is authored at, which
 * the server names for the repository and the console reads as given.
 */
export function creationBootstrapRevision(repository: string): string {
  return `${bootstrapConfigurationRevisionPrefix}${repository}`;
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
        : {
            result: "Bootstrapped",
            revision: creationBootstrapRevision(binding.repository),
          },
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

/** A catalog of several workloads, plans and finalizers, each prompt
 * inline as an import resolves it. */
export const creationCatalogCanonical = JSON.stringify({
  version: 2,
  image: "an-image",
  workloads: {
    build: {
      runner: "Agent",
      prompt: { path: "prompts/build.md", text: "Build it.\nTest it." },
      worker: { mode: { type: "SingleAgent", agent: "Claude", arguments: [] } },
    },
    quick: {
      runner: "Agent",
      prompt: { text: "Do it fast." },
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Codex",
          arguments: [],
          model: "gpt-5-codex",
        },
      },
    },
    gates: { runner: "Commands", commands: ["npm test"] },
    review: {
      runner: "Agent",
      purpose: "Review",
      prompt: { text: "Review it." },
      worker: { mode: { type: "SingleAgent", agent: "Claude", arguments: [] } },
    },
  },
  plans: {
    review: [{ name: "review", evaluators: ["review"] }],
    gated: [
      { name: "review", evaluators: ["review", "review"] },
      { name: "gates", evaluators: ["gates"] },
    ],
  },
  finalizers: {
    land: { approvalRequired: false },
    approved: { approvalRequired: true },
  },
  defaults: { work: "build", evaluation: "review", finalization: "land" },
});

/** An offer whose configuration is the catalog above, initialized under its defaults. */
export function creationCatalogOffer(
  listed: ConfigurationSummary = creationSummary("c1", "Ready"),
): CreationOffer {
  const offer = creationOffer(listed, {
    choices: { programStagesMax: 1, evaluatorsMax: 3 },
  });
  return {
    ...offer,
    initialization: {
      ...offer.initialization,
      configuration: {
        ...offer.initialization.configuration,
        canonical: creationCatalogCanonical,
      },
    },
  };
}

/**
 * An offer of the same catalog defaulting to its plan of a two-evaluator stage
 * and a one-evaluator stage, initialized as the API answers under that default.
 */
export function creationGatedOffer(
  listed: ConfigurationSummary = creationSummary("c1", "Ready"),
): CreationOffer {
  const offer = creationCatalogOffer(listed);
  const catalog = JSON.parse(creationCatalogCanonical) as {
    defaults: Record<string, string>;
  };
  catalog.defaults["evaluation"] = "gated";
  return {
    ...offer,
    initialization: configurationCatalogInitialization(
      {
        ...offer.initialization,
        configuration: {
          ...offer.initialization.configuration,
          canonical: JSON.stringify(catalog),
        },
      },
      undefined,
    ),
  };
}
