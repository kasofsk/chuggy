/**
 * The document `GET /api/v1/contract` answers with: the wire's own description
 * of itself, generated from the checked request schemas rather than written
 * beside them.
 */

import type { z } from "zod";
import {
  accessTokenLifetimeDaysMax,
  accessTokenMintRequestSchema,
  accessTokenNameCharsMax,
  accessTokensHeldMax,
  accessTokensProjectMax,
} from "./accessToken.ts";
import { nativeHttpEndpoints } from "./endpoints.ts";

import {
  inboxPhases,
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpRoutes,
  nativeHttpVersion,
  personalRunnersMax,
  threadsOpenDefault,
  ticketActiveFinishedHours,
  ticketSearchCharsMax,
} from "./http.ts";
import {
  agentAccountSettingsSchema,
  draftCreationSchema,
  draftRevisionSchema,
  executionPlacementSchema,
  forgeCredentialRequestSchema,
  forgeAuthorizationSchema,
  projectCreationSchema,
  projectDisplayNameCharsMax,
  projectNameCharsMax,
  projectRepositoryBindSchema,
  projectRepositoryConfigureSchema,
  projectRepositoryLandingSchema,
  projectRepositoryRetirementSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
  reservedTenantNames,
  selectorProjectSettingsSchema,
  sessionPlacementSchema,
  threadLimitSchema,
  personalRunnerProjectSchema,
  personalRunnerRedemptionSchema,
  projectOwnerFallbackSchema,
  registrationTokenRequestSchema,
} from "./requests.ts";
import { epicWriteRequestSchema } from "./epics.ts";
import { actionReportDocumentSchema } from "./actionReport.ts";
import { contractJsonSchemaInput } from "./jsonSchema.ts";

/** A request body as the JSON Schema of what its parser takes, which is the body a client sends. */
function nativeHttpContractDocumentInput(schema: z.ZodType): unknown {
  return contractJsonSchemaInput(schema);
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
    personalRunnerProject: nativeHttpContractDocumentInput(
      personalRunnerProjectSchema,
    ),
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
    projectRepositoryLanding: nativeHttpContractDocumentInput(
      projectRepositoryLandingSchema,
    ),
    projectRepositoryRetirement: nativeHttpContractDocumentInput(
      projectRepositoryRetirementSchema,
    ),
    projectRepositoryConfigure: nativeHttpContractDocumentInput(
      projectRepositoryConfigureSchema,
    ),
    selectorProjectSettings: nativeHttpContractDocumentInput(
      selectorProjectSettingsSchema,
    ),
    threadOpen: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.openThread.body,
    ),
    threadLimit: nativeHttpContractDocumentInput(threadLimitSchema),
    accessTokenMint: nativeHttpContractDocumentInput(
      accessTokenMintRequestSchema,
    ),
    agentAccountSettings: nativeHttpContractDocumentInput(
      agentAccountSettingsSchema,
    ),
    threadMessage: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.sendThreadMessage.body,
    ),
    threadOfferReply: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.replyThreadOffer.body,
    ),
    chatThreadMessage: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.sendChatThreadMessage.body,
    ),
    epicWrite: nativeHttpContractDocumentInput(epicWriteRequestSchema),
    threadRename: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.renameThread.body,
    ),
    threadHide: nativeHttpContractDocumentInput(
      nativeHttpEndpoints.hideThread.body,
    ),
    ...nativeHttpContractDocumentSchemasMachine(),
  };
}

/** The request bodies a runner or a reporter sends rather than a member. */
function nativeHttpContractDocumentSchemasMachine(): Record<string, unknown> {
  return {
    workerPoolRegistrationToken: nativeHttpContractDocumentInput(
      registrationTokenRequestSchema,
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
  nativeActionHistory:
    "every native action a ticket has had, open and settled, oldest fence first, resumed by the cursor a page answers, which names the ticket and no other read takes: its kind, its state, Open, Resolved or Withdrawn, the answer a Resolved one was given, the execution an EvaluationApproval asked about, and who answered it and when where that is recorded, which is on an answered EvaluationApproval alone; it is read as the ticket is",
  ticketLandings:
    "each finalization a ticket has had, oldest first and the newest of them where it has had more than one read answers, as what is recorded of it: Running, Held at the last hold recorded, Failed where it sent the ticket back to work, Unavailable where it escalated, Landed with the commit it landed at, Proposed where it concluded at an open pull request, or Invalidated; with its newest attempt, the paths a conflict its manifest records named, and its pull request; one that landed nothing and tried nothing is left out; it is read as the ticket is, written with no event, and polled",
};

/** Where a project's work and sessions run, and the runners that take it. */
const runnerNotes = {
  executionPlacement:
    "where a project's work and evaluations run is decided per kind by the deployment's override for the project, else the project's own placement, else the deployment's default; an administrator writes both routes whole, and choosing InCluster needs the tenant's hosted grant, as a session on that route does",
  sessionPlacement:
    "where a project's threads run is decided the same way; a turn admitted InCluster spends the tenant's hosted grant and one admitted on Pool is offered to its member's chat host instead, so a member with no chat host is refused NoRunner; a turn runs where it was admitted, so a change moves the next turn and never one already queued, and one offered to a chat host that does not take it within the scheduler's dwell is withdrawn; the read says whether the member's chat host is registered and has polled lately; it answers its runners' project, lead, leadOffering and leadOfferings as fixed values for older clients, and a write's lead and leadOffering are ignored",
  ownerFallback:
    "a project names no fallback until an administrator writes one, and while it names none no personal runner takes its work; an execution routed to runners whose ticket a member wrote may then be taken by any of that member's personal runners where they serve the project; under Strict no pool takes it while they have any, and under Preferred a pool takes it while none of theirs offered its agent has polled lately; an execution keeps the fallback it was registered under, and the read says whether the caller may change it",
  personalRunnerRegistration: `a member the tenant permits to register a personal runner mints a single-use token for the tenant; redeeming it adds one more runner of that member's there, each held to its own bound on the work it takes, refused while they hold ${String(personalRunnersMax)}, and answers once with a file of kind Personal naming the tenant and the member and no project; a member's runners serve one list of projects, and serve none until their owner adds one they may read, each at a priority, High, Normal or Low, Normal where the addition names none; of the work they could take now, a ticket's that a runner has already started is taken first, then a higher project's; a runner is taken off by its owner, by its id or with all of theirs, and every runner of a member by an administrator of the tenant, and the list goes with the last of them; a member reads whether the tenant permits them, each of their runners' newest poll and whether it is live, and each agent their runners are paused for, which is one where every runner of theirs offered it, of those polling now where any is, holds the pause of the credentials it named, or the agent's own where it named none, with the one that ends first`,
  agentAccounts:
    "a caller reads and sets their own agent accounts alone, the logins their runners spend, and no route names another principal: for each agent, the share of each window a reading at or over pauses it at, a whole percentage held at its default until they write their own, whether their threads pause with it, each window's newest reading across its credentials and when it was read, the newest limit a provider stopped it at across them, and the pause these come to now, which holds only while every credential their live runners name of it is paused and lasts until the earliest of those ends, or, where those runners name none, holds while any credential is paused and lasts until the latest reason holding it ends; and each credential it holds a reading or a limit of, by name, with each window's reading of that credential and the pause holding it alone, which a press of the agent lets one claim through as it does the agent's; a runner, pool or chat host of theirs that named credentials of a paused agent takes its work, a chat host's threads among it, while any of those is free, and one that named none takes none of it; a press tries the agent once past a limit, letting one claim through it and no threshold, and is refused NotHardPaused where no limit holds the agent; retiring a credential by its name drops its readings and its limit, so the account reads it no more until a run reports it again, is not found where none is held under that name, and is refused CredentialInUse while a live runner of theirs names it unless it is off; turning a credential off by its name, which needs no reading or limit of it, holds every runner of theirs off it until they turn it on again, its pause reading off with no end, a thread waiting on it whatever their option, a ticket held only by it reading off rather than a resume time, and an off credential pausing an agent no live runner names credentials of only by its own readings and limit; it is refused OffFull while as many of that agent's credentials are off as the bound admits, and turning on one that is not off is not found",
  chatHostRegistration:
    "a member the tenant permits to register a personal runner mints, under the same permit and bound, a single-use token for their chat host in the tenant; redeeming it at the same route a runner's token is redeemed at registers the member's one chat host there, replacing any other and ending every session the replaced one held, and answers once with a file of kind ChatHost naming the tenant and the member and no project or capabilities; a chat host serves its member's threads in every project of the tenant they may read, and needs no list; its owner reads its newest poll and whether it is live, and takes it off, which ends every session it held",
};

/** The query parameters that narrow what a listing reads, and what each answers. */
const listingFilterNotes = {
  ticketPhaseFilter: {
    query: "phase",
    all: "omit phase",
    nonTerminal: "phase=NonTerminal",
    selected: "repeat phase with one or more exact phase names",
  },
  ticketListQuery: {
    search: `q: from 1 to ${String(ticketSearchCharsMax)} characters once trimmed; a ticket matches where its title holds them, ignoring case and with every character as itself, or where they are its number, whole, with or without a leading #; the answer carries matched, how many tickets the read selects across the project`,
    creator:
      "creator: one principal, encoded as a ticket's creator is; only the tickets that member filed, and the answer carries matched as a search's does",
    owner:
      "owner: one principal, encoded as a ticket's owner is; only the tickets that member owns, and the answer carries matched as a search's does",
    active: `active=true: the tickets neither Done nor Revoked, and those that became either within the last ${String(ticketActiveFinishedHours)} hours`,
    order:
      "omit order: by ticket, ascending, resumed by after; RecentActivity: last activity first; Newest and Oldest: by ticket, descending and ascending; each resumed by a cursor of its own that another order refuses",
    composition: "each composes with phase and with the others",
    latestExecution:
      "each row carries latestExecution, what the row draws of the execution latest=true answers for its ticket, and a ticket nothing has run carries none; neither the ticket's own read nor its change frame carries it",
  },
  configurationLatestFilter: {
    query: "latest",
    all: "omit latest, or latest=false: every revision, newest first",
    latest:
      "latest=true: the newest revision of each repository and name, newest first, and each revision imported from no repository, a bootstrap among them, as its own; a cursor pages that narrowed listing",
  },
  repositoryReachFilter: {
    query: "reach",
    all: "omit reach, or reach=true: each live binding with what the worker App reaches of it, asked of the forge",
    unasked:
      "reach=false: the same bindings, the forge not asked and no binding carrying workerReach, which says nothing of what the worker App reaches",
  },
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
    eventRepresentations:
      "a change frame carries the body its kind's own read answers, except Project, which carries the project's inventory entry; Execution, which carries the row the executions list answers for that execution and none of its attempts or result; and Session, which carries null; a page showing one of these reads it from its own route",
    caching: "no-store",
    cors: "same-origin",
    credentials: "authorization bearer header; no cookies",
    ...listingFilterNotes,
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
      latest:
        "latest=true: each ticket's highest task, of any status, highest ticket first, under a cursor of its own that the other order refuses; it takes no ticket or state",
    },
    briefFinalization:
      "a finalization is named by its kind: a GitMerge by its mode and its policy, a PullRequest, or None; one written by its mode, with a landing beside it, is read as the kind it maps to, and a PullRequest or None landing Serialized or Stacked maps to none and is refused, as is a Serialized or Stacked landing with no finalization and a landing beside a finalization naming its kind; a finalization that opens a proposal, a PullRequest or a GitMerge by PullRequestMerge, requires the brief to name a branch, and a target that is not it where it names one; a proposal naming no target opens into the repository's default branch",
    selectorProjectSettings:
      "installation settings are defaults; an absent override inherits one, and a write replaces the whole set under the revision it was read at",
    inbox: `one entry for each ticket a person is needed for: one in ${inboxPhases.join(" or ")}, and one with an open native action; each entry is the row the tickets list answers, latestExecution included, with the ticket's open actions; last activity first as the tickets list orders it, resumed by the cursor a page answers, and count is every ticket the inbox holds, on every page`,
    landingQueues:
      "for each reference a Serialized or Stacked ticket of the project holds or waits on, by repository and then target: its repository, the target its briefs name, absent where they name none, which is not resolved to the repository's default, so a ticket naming the default and one naming none are in two queues; the ticket holding it and the tickets waiting on it in rank order, each by number; the holder's phase, and holderSince, when it became the holder: the later of when it took its rank and when the ticket that held the queue before it stopped holding it, by landing or by any other release, so a re-check, a re-stack, a re-evaluation and an invalidation, which keep its rank, leave it unchanged; a ticket ranks from its first finalization request while it is in Work, Evaluation or Finalization, and a Direct ticket, a pull request, a landing of nothing and a ticket naming no repository are in none; where more tickets rank than one read answers, the earliest-ranked are answered and truncated is true, so a queue answered has its holder and its earliest waiters and one whose every ticket ranks later is left out; it is read as the project's tickets are, written with no event, and polled",
    threadLimit: `a member holds at most their limit of open threads in a project, ${String(threadsOpenDefault)} until an administrator of the project sets theirs; opening is idempotent on the key its client sends, answering the thread that key opened whatever its state, and an open at the limit is refused ThreadLimitReached; a limit lowered below what a member holds closes nothing`,
    forgeInstallations:
      "a tenant's administrator claims an account by authorizing this deployment's app on the forge, which claims each account the forge says they own and nothing else; each tenant holds its own claim, and a claim is released only with its workspace's deletion",
    projectCreation: `a principal creates a project in a tenant it administers, or, where the site permits it to create a tenant, in a tenant no grant holds, which it then administers, and a caller the site does not permit is refused for such a tenant before anything is written; a tenant is held by its row, by any grant on it and by any project inheriting from it, and a held tenant the caller does not administer is a conflict; each name is at most ${String(projectNameCharsMax)} lowercase letters, digits and hyphens that begin and end with a letter or digit, a new tenant may not be named ${reservedTenantNames.join(", ")}, the project's display name is any text of at most ${String(projectDisplayNameCharsMax)} characters once trimmed that is not empty and holds no control character, and is answered with the project when it is created and listed, and its creator repeating the request, under any idempotency key, answers the same project`,
    unrunDeletion:
      "a tenant's administrator deletes a project that has never run work, and the site's administrator then a workspace holding no project: GET on the deletion route answers held, what keeps it — for a project a ReleasedTicket, an Execution, a Session, a WorkerPool or an ActionObservation, for a workspace a Project, a PersonalRunner, a ChatHost or a Session — empty where DELETE would delete it, which answers 204, or 409 DeletionHeld with held; a project's deletion removes its drafts, epics, bound repositories, imported configurations, settings and grants, and a workspace's its grants, invite links, forge claims and row, so its name may be taken again; a caller who may not delete it is answered not found",
    ticketTake:
      "a member who may file drafts takes a released ticket that is neither Done nor Revoked, which makes them its owner, the member its next execution is placed for: a take names no member but its caller, replaces a taker before them, and answers AlreadyOwner where the caller owns it already; its taker alone returns it, to its creator; an execution keeps the owner it was registered under; a draft never released is refused Unreleased, a Done or Revoked ticket TicketDone or TicketRevoked, a return by anyone but the taker NotTaker, and every session bearer but a thread's, which takes and returns as its member; every take and return is kept",
    accessTokens: `a caller holding the project's make_access_tokens permit, which its administrators hold, makes an access token that acts as them in the project until it is deleted or expires: it names a name of at most ${String(accessTokenNameCharsMax)} characters on one line and not blank, Read or Write access, and lifetimeDays from 1 to ${String(accessTokenLifetimeDaysMax)}, and is answered 201 with the token and its secret, which no other answer holds; a reader of the project without the permit is refused 403 AccessTokenMintForbidden, a name the caller already holds in the project 409 AccessTokenNameTaken, and a caller holding ${String(accessTokensHeldMax)} tokens in the project, or a project holding ${String(accessTokensProjectMax)}, 409 AccessTokenLimitReached, expired tokens counting until they are deleted; a reader lists their own tokens and an administrator every one, newest first, each with its maker; a token's maker or an administrator deletes it, which answers 204 and revokes it; a caller who may not read the project, or may not see the token, is answered not found, and every session bearer is refused`,
    ticketProposalMerge:
      "a caller holding the project's merge_proposals permit, which its administrators hold, has this deployment's portal app merge the pull request the ticket's newest successful landing opened, at the head that landing evaluated; the pull request is read first, and one merged already answers Merged, so a second press changes nothing; one closed unmerged is refused Closed, one conflicting with its base Conflicting, one the forge's own rules block Blocked, one its base has moved past Behind, a head pushed since HeadMoved, one the forge would not merge for a reason it did not name NotMergeable, and a refusal of the app AppDenied, each 409 with the pull request's link; a caller who may read the ticket and not merge is refused 403 ProposalMergeForbidden, a ticket whose newest success opened no pull request is not found, a deployment holding no portal key or a forge that cannot be reached answers 503, and every session bearer is refused; nothing is recorded and no ticket moves, since the merge is the forge's and is read as one a person made there",
    repositoryBinding:
      "binding a repository to a project creates no project: a project that does not exist is not found, and the repository must be one this deployment holds a credential for — on a host it mints for, that means an installation this tenant has claimed",
    repositoryLanding:
      "a repository's landing default is the finalization a ticket in it lands by unless its brief or its finalizer names one: a GitMerge by its mode and its policy, a PullRequest, or None, and never a reference, which stays the brief's; a binding answers it as finalization and its mode alone as landing, a write names it either way, one named by its mode alone ordered Direct, and it is written whole against the value the writer read; a ticket whose landing is None names no reference to land on",
    repositoryRetirement:
      "a retired repository stays readable by name, stops being the one a session is placed against, the importer or the import route reads, a brief may name or the credential route mints for, and is free for any project to bind; this route only retires and repeating it changes nothing, and binding the repository again here reinstates it unless another project now holds it",
    repositoryConfigurations:
      "a newly bound repository is imported at its own default-branch head, and one declaring no configurations is authored a bootstrap; the step is reported beside the binding and never refuses it, and is asked for again through its own route, which runs it for a live binding the project holds no configuration from and no bootstrap of its own that still releases and otherwise answers what the project holds; a bootstrap is one revision per repository, named for it, and never rewritten, so two requests racing author it once and a repository meeting its own whose text differs, worded otherwise or outgrown by the release rule, defers as BootstrapDiffers until it declares its own; a ticket releases under a repository's bootstrap in that repository alone",
    ...runnerNotes,
    actionReports:
      "a reporter this deployment names reports what one declared action did at one commit, to the action's own address and proving itself by its own scheme rather than a bearer of this server's; a report repeating the commit and outcome of the action's newest is answered Repeated and records nothing, a verified request its scheme reads no outcome in is answered Ignored and records nothing, and a request that proves nothing is not found",
    ...ticketSubReadNotes,
    routes: nativeHttpRoutes,
    schemas: nativeHttpContractDocumentSchemas(),
  };
}
