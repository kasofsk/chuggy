/**
 * The document `GET /api/v1/contract` answers with: the wire's own description
 * of itself, generated from the checked request schemas rather than written
 * beside them.
 */

import { z } from "zod";
import { nativeHttpEndpoints } from "./endpoints.ts";

import {
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpRoutes,
  nativeHttpVersion,
} from "./http.ts";
import {
  configurationCreationSchema,
  draftCreationSchema,
  draftRevisionSchema,
  executionPlacementSchema,
  forgeCredentialRequestSchema,
  forgeAuthorizationSchema,
  projectCreationSchema,
  projectNameCharsMax,
  projectRepositoryBindSchema,
  projectRepositoryConfigureSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  projectRepositoryRetirementSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
  reservedTenantNames,
  selectorProjectSettingsSchema,
  sessionPlacementSchema,
} from "./requests.ts";
import {
  workerPoolRedemptionSchema,
  workerPoolRegistrationTokenRequestSchema,
} from "./workerPool.ts";
import { actionReportDocumentSchema } from "./actionReport.ts";

/** Every request body the document publishes, as the JSON Schema its own parser induces. */
function nativeHttpContractDocumentSchemas(): unknown {
  return {
    publicMutation: z.toJSONSchema(publicMutationSchema),
    configurationCreation: z.toJSONSchema(configurationCreationSchema),
    repositoryConfigurationImport: z.toJSONSchema(
      repositoryConfigurationImportSchema,
    ),
    draftCreation: z.toJSONSchema(draftCreationSchema),
    draftRevision: z.toJSONSchema(draftRevisionSchema),
    executionPlacement: z.toJSONSchema(executionPlacementSchema),
    sessionPlacement: z.toJSONSchema(sessionPlacementSchema),
    forgeCredential: z.toJSONSchema(forgeCredentialRequestSchema),
    forgeAuthorization: z.toJSONSchema(forgeAuthorizationSchema),
    projectCreation: z.toJSONSchema(projectCreationSchema),
    projectRepositoryBind: z.toJSONSchema(projectRepositoryBindSchema),
    projectRepositoryCreate: z.toJSONSchema(projectRepositoryCreateSchema),
    projectRepositoryLanding: z.toJSONSchema(projectRepositoryLandingSchema),
    projectRepositoryRetirement: z.toJSONSchema(
      projectRepositoryRetirementSchema,
    ),
    projectRepositoryConfigure: z.toJSONSchema(
      projectRepositoryConfigureSchema,
    ),
    leadInquiry: z.toJSONSchema(nativeHttpEndpoints.askLead.body),
    selectorProjectSettings: z.toJSONSchema(selectorProjectSettingsSchema),
    selectorProposalReview: z.toJSONSchema(
      nativeHttpEndpoints.reviewSelectorProposal.body,
    ),
    threadMessage: z.toJSONSchema(nativeHttpEndpoints.sendThreadMessage.body),
    threadRename: z.toJSONSchema(nativeHttpEndpoints.renameThread.body),
    threadHide: z.toJSONSchema(nativeHttpEndpoints.hideThread.body),
    workerPoolRegistrationToken: z.toJSONSchema(
      workerPoolRegistrationTokenRequestSchema,
    ),
    workerPoolRedemption: z.toJSONSchema(workerPoolRedemptionSchema),
    actionReport: z.toJSONSchema(actionReportDocumentSchema),
  };
}

export function nativeHttpContractDocument(): unknown {
  return {
    version: nativeHttpVersion,
    basePath: nativeHttpBasePath,
    mediaType: nativeHttpMediaType,
    authentication: {
      scheme: "Bearer",
      formats: ["OIDC JWT", "session bearer"],
      principal: "length-prefixed issuer and subject",
      session:
        "a session bearer authorizes as the session's principal within the session's own tenant and project only, and is recorded on the operation; another project is not found, and a route no session may reach answers 403 insufficient_scope",
    },
    notifications: "bounded-polling",
    events: "sse",
    caching: "no-store",
    cors: "same-origin",
    credentials: "authorization bearer header; no cookies",
    ticketPhaseFilter: {
      query: "phase",
      all: "omit phase",
      nonTerminal: "phase=NonTerminal",
      selected: "repeat phase with one or more exact phase names",
    },
    identities: {
      installation: "canonical UUID authority identity",
      tenant: "percent-encoded opaque UTF-8 path segment",
      project: "percent-encoded opaque UTF-8 path segment",
      ticket: "canonical positive decimal integer",
      operation: "percent-encoded opaque UTF-8 path segment",
      cursor: "opaque canonical base64url",
    },
    executionOrder: {
      order: "ticket then task, ascending",
      cursor: "a position in that order; the ticket filter narrows it",
      mismatch: "a cursor resuming an unselected ticket is refused",
    },
    briefFinalization:
      "a PullRequest finalization requires the brief to name a branch, and a target that is not it where it names one; a proposal naming no target opens into the repository's default branch",
    selectorProjectSettings:
      "installation settings are defaults; an absent override inherits one, and a write replaces the whole set under the revision it was read at",
    selectorProposals:
      "where a project's dispatch mode is ApprovalRequired each lead decision is held until a principal who may dispatch its tickets answers it whole: an approval dispatches each ticket it named that has not moved since, and a rejection ends it; the note given with either is in the lead's next observation, and answering a decision no longer held is a conflict",
    forgeInstallations:
      "a tenant's administrator claims an account by authorizing this deployment's app on the forge, which claims each account the forge says they own and nothing else; each tenant holds its own claim, and a claim is never released",
    projectCreation: `a principal creates a project in a tenant it administers, or in a tenant nothing holds, which it then administers; a tenant is held by its row, by any grant on it and by any project inheriting from it, and a held tenant the caller does not administer is a conflict; each name is at most ${String(projectNameCharsMax)} lowercase letters, digits and hyphens that begin and end with a letter or digit, a new tenant may not be named ${reservedTenantNames.join(", ")}, and its creator repeating the request, under any idempotency key, answers the same project`,
    repositoryBinding:
      "binding a repository to a project creates no project: a project that does not exist is not found, and the repository must be one this deployment holds a credential for — on a host it mints for, that means an installation this tenant has claimed",
    repositoryLanding:
      "a repository's landing default is the mode a ticket in it lands by unless its brief names one; it is written against the value the writer read, and a ticket whose landing is None names no reference to land on",
    repositoryRetirement:
      "a retired repository stays bound and stays readable by name, and stops being the one a session is placed against, the importer reads or a brief may name; this route only retires and repeating it changes nothing, and binding the repository again reinstates it",
    repositoryConfigurations:
      "a newly bound repository is imported at its own default-branch head, and one declaring no configurations is authored a bootstrap; the step is reported beside the binding and never refuses it, and is asked for again through its own route, which runs it for a live binding the project holds no configuration from and no bootstrap that still releases and otherwise answers what the project holds; the bootstrap is one revision per project and never rewritten, so two requests racing author it once and a repository meeting one whose text differs, being another repository's or outgrown by the release rule, defers as BootstrapDiffers until it declares its own",
    repositoryCreation:
      "creating a repository requires this tenant's claims of both apps on the account; the repository is the forge's from the moment it answers, so a later refusal is reported beside one that stands and a name already taken is bound rather than created",
    executionPlacement:
      "where a project's work and evaluations run is decided per kind by the deployment's override for the project, else the project's own placement, else the deployment's default; an administrator writes both routes whole, and choosing InCluster needs the tenant's hosted grant, as a session on that route does",
    sessionPlacement:
      "where a project's threads and its lead run is decided the same way, and an inquiry runs where the lead does; a turn admitted InCluster spends the tenant's hosted grant and one admitted on Pool is offered to runners instead, the member's own for a thread and any of the project's for the lead, so a member with no runner registered on the project is refused NoRunner; a turn runs where it was admitted, so a change moves the next turn and never one already queued, and one offered to runners that none takes within the scheduler's dwell is withdrawn; the read says whether such a runner is registered and has polled lately",
    workerPoolRegistration:
      "an administrator mints a single-use token for one project; redeeming it registers the pool and answers once with the file a runner keeps, its secret included",
    actionReports:
      "a reporter this deployment names reports what one declared action did at one commit, to the action's own address and proving itself by its own scheme rather than a bearer of this server's; a report repeating the commit and outcome of the action's newest is answered Repeated and records nothing, a verified request its scheme reads no outcome in is answered Ignored and records nothing, and a request that proves nothing is not found",
    routes: nativeHttpRoutes,
    schemas: nativeHttpContractDocumentSchemas(),
  };
}
