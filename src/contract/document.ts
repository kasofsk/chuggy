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
  personalRunnersMax,
} from "./http.ts";
import {
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
  personalRunnerRedemptionSchema,
  projectOwnerFallbackSchema,
} from "./requests.ts";
import {
  workerPoolRedemptionSchema,
  workerPoolRegistrationTokenRequestSchema,
} from "./workerPool.ts";
import { actionReportDocumentSchema } from "./actionReport.ts";

/** A request body as the JSON Schema of what its parser takes, which is the body a client sends. */
function nativeHttpContractDocumentInput(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "input" });
}

/** Every request body the document publishes, as the JSON Schema its own parser induces. */
function nativeHttpContractDocumentSchemas(): unknown {
  return {
    publicMutation: nativeHttpContractDocumentInput(publicMutationSchema),
    repositoryConfigurationImport: nativeHttpContractDocumentInput(
      repositoryConfigurationImportSchema,
    ),
    draftCreation: nativeHttpContractDocumentInput(draftCreationSchema),
    draftRevision: nativeHttpContractDocumentInput(draftRevisionSchema),
    executionPlacement: nativeHttpContractDocumentInput(
      executionPlacementSchema,
    ),
    sessionPlacement: nativeHttpContractDocumentInput(sessionPlacementSchema),
    ownerFallback: nativeHttpContractDocumentInput(projectOwnerFallbackSchema),
    forgeCredential: nativeHttpContractDocumentInput(
      forgeCredentialRequestSchema,
    ),
    forgeAuthorization: nativeHttpContractDocumentInput(
      forgeAuthorizationSchema,
    ),
    projectCreation: nativeHttpContractDocumentInput(projectCreationSchema),
    projectRepositoryBind: nativeHttpContractDocumentInput(
      projectRepositoryBindSchema,
    ),
    projectRepositoryCreate: nativeHttpContractDocumentInput(
      projectRepositoryCreateSchema,
    ),
    projectRepositoryLanding: nativeHttpContractDocumentInput(
      projectRepositoryLandingSchema,
    ),
    projectRepositoryRetirement: nativeHttpContractDocumentInput(
      projectRepositoryRetirementSchema,
    ),
    projectRepositoryConfigure: nativeHttpContractDocumentInput(
      projectRepositoryConfigureSchema,
    ),
    leadInquiry: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.askLead.body,
    ),
    selectorProjectSettings: nativeHttpContractDocumentInput(
      selectorProjectSettingsSchema,
    ),
    selectorProposalReview: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.reviewSelectorProposal.body,
    ),
    threadMessage: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.sendThreadMessage.body,
    ),
    threadRename: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.renameThread.body,
    ),
    threadHide: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.hideThread.body,
    ),
    workerPoolRegistrationToken: nativeHttpContractDocumentInput(
      workerPoolRegistrationTokenRequestSchema,
    ),
    workerPoolRedemption: nativeHttpContractDocumentInput(
      workerPoolRedemptionSchema,
    ),
    personalRunnerRedemption: nativeHttpContractDocumentInput(
      personalRunnerRedemptionSchema,
    ),
    actionReport: nativeHttpContractDocumentInput(actionReportDocumentSchema),
  };
}

/** What the document says of the reads a ticket has beside its own, in the order it says them. */
const ticketSubReadNotes = {
  actionReach:
    "for each action a ticket's repository declares, whether what was reported of the action holds the commit the ticket landed at: Reached where its newest success does, Failed where its newest report is a failure that does, RolledBack where only a success beneath its newest, reported since the ticket landed, does, NotYet where none does, and Unknown where this server could not find out inside the time one read is given, which it answers rather than wait and a later read may answer otherwise; a mark read from a report shows it; a ticket that has landed nowhere, which one whose proposal a person is left to merge is, answers no repository, commit or actions; it is read as the ticket is and derived each time it is asked",
  ticketLandings:
    "each finalization a ticket has had, oldest first and the newest of them where it has had more than one read answers, as what is recorded of it: Running, Held at the last hold recorded, AwaitingApproval while a person has an approval open, Failed where it sent the ticket back to work, Unavailable where it escalated, Landed with the commit it landed at, Proposed where it concluded at an open pull request, or Invalidated; with its newest attempt, the paths a conflict its manifest records named, and its pull request; one that landed nothing and tried nothing is left out; it is read as the ticket is, written with no event, and polled",
};

/** Where a project's work and sessions run, and the runners that take it. */
const runnerNotes = {
  executionPlacement:
    "where a project's work and evaluations run is decided per kind by the deployment's override for the project, else the project's own placement, else the deployment's default; an administrator writes both routes whole, and choosing InCluster needs the tenant's hosted grant, as a session on that route does",
  sessionPlacement:
    "where a project's threads and its lead run is decided the same way, and an inquiry runs where the lead does; a turn admitted InCluster spends the tenant's hosted grant and one admitted on Pool is offered to runners instead: a thread to its member's personal runners where they serve the project, an inquiry to a pool its member registered on the project, and the lead to any of the project's pools, so a member with no such runner for their thread or inquiry is refused NoRunner; a turn runs where it was admitted, so a change moves the next turn and never one already queued, and one offered to runners that none takes within the scheduler's dwell is withdrawn; the read says whether such a runner is registered and has polled lately",
  ownerFallback:
    "a project names no fallback until an administrator writes one, and while it names none no personal runner takes its work; an execution routed to runners whose ticket a member wrote may then be taken by any of that member's personal runners where they serve the project; under Strict no pool takes it while they have any, and under Preferred a pool takes it while none of theirs has polled lately; an execution keeps the fallback it was registered under, and the read says whether the caller may change it",
  workerPoolRegistration:
    "an administrator mints a single-use token for one project; redeeming it registers the pool and answers once with the file a runner keeps, its secret included",
  personalRunnerRegistration: `a member the tenant permits to register a personal runner mints a single-use token for the tenant; redeeming it adds one more runner of that member's there, each held to its own bound on the work it takes, refused while they hold ${String(personalRunnersMax)}, and answers once with a file of kind Personal naming the tenant and the member and no project; a member's runners serve one list of projects, and serve none until their owner adds one they may read; a runner is taken off by its owner, by its id or with all of theirs, and every runner of a member by an administrator of the tenant, and the list goes with the last of them; a member reads whether the tenant permits them, and each of their runners' newest poll and whether it is live`,
};

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
    projectCreation: `a principal creates a project in a tenant it administers, or, where the site permits it to create a tenant, in a tenant no grant holds, which it then administers, and a caller the site does not permit is refused for such a tenant before anything is written; a tenant is held by its row, by any grant on it and by any project inheriting from it, and a held tenant the caller does not administer is a conflict; each name is at most ${String(projectNameCharsMax)} lowercase letters, digits and hyphens that begin and end with a letter or digit, a new tenant may not be named ${reservedTenantNames.join(", ")}, and its creator repeating the request, under any idempotency key, answers the same project`,
    repositoryBinding:
      "binding a repository to a project creates no project: a project that does not exist is not found, and the repository must be one this deployment holds a credential for — on a host it mints for, that means an installation this tenant has claimed",
    repositoryLanding:
      "a repository's landing default is the mode a ticket in it lands by unless its brief names one; it is written against the value the writer read, and a ticket whose landing is None names no reference to land on",
    repositoryRetirement:
      "a retired repository stays readable by name, stops being the one a session is placed against, the importer or the import route reads, a brief may name or the credential route mints for, and is free for any project to bind; this route only retires and repeating it changes nothing, and binding the repository again here reinstates it unless another project now holds it",
    repositoryConfigurations:
      "a newly bound repository is imported at its own default-branch head, and one declaring no configurations is authored a bootstrap; the step is reported beside the binding and never refuses it, and is asked for again through its own route, which runs it for a live binding the project holds no configuration from and no bootstrap that still releases and otherwise answers what the project holds; the bootstrap is one revision per project and never rewritten, so two requests racing author it once and a repository meeting one whose text differs, being another repository's or outgrown by the release rule, defers as BootstrapDiffers until it declares its own",
    repositoryCreation:
      "creating a repository requires this tenant's claims of both apps on the account; the repository is the forge's from the moment it answers, so a later refusal is reported beside one that stands and a name already taken is bound rather than created",
    ...runnerNotes,
    actionReports:
      "a reporter this deployment names reports what one declared action did at one commit, to the action's own address and proving itself by its own scheme rather than a bearer of this server's; a report repeating the commit and outcome of the action's newest is answered Repeated and records nothing, a verified request its scheme reads no outcome in is answered Ignored and records nothing, and a request that proves nothing is not found",
    ...ticketSubReadNotes,
    routes: nativeHttpRoutes,
    schemas: nativeHttpContractDocumentSchemas(),
  };
}
