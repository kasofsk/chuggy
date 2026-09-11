/**
 * The document `GET /api/v1/contract` answers with: the wire's own description
 * of itself, generated from the checked request schemas rather than written
 * beside them.
 */

import { z } from "zod";

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
  forgeCredentialRequestSchema,
  forgeInstallationClaimSchema,
  leadInquirySchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
  selectorProjectSettingsSchema,
  threadHideRequestSchema,
  threadMessageSchema,
  threadRenameRequestSchema,
} from "./requests.ts";

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
        "a session bearer authorizes as the session's principal and is recorded on the operation",
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
      "a PullRequest finalization requires the brief to name a branch, and a target that is not it",
    selectorProjectSettings:
      "installation settings are defaults; an absent override inherits one, and a write replaces the whole set under the revision it was read at",
    forgeInstallations:
      "a tenant's administrator claims an installation of this deployment's app; an installation another tenant holds is a conflict, and a claim is never released",
    repositoryBinding:
      "binding a repository to a project creates no project: a project that does not exist is not found, and the repository must be one this deployment holds a credential for — on a host it mints for, that means an installation this tenant has claimed",
    repositoryConfigurations:
      "a newly bound repository is imported at its own default-branch head, and one declaring no configurations is authored a bootstrap; the step is reported beside the binding and never refuses it",
    repositoryCreation:
      "creating a repository requires this tenant's claims of both apps on the account; the repository is the forge's from the moment it answers, so a later refusal is reported beside one that stands and a name already taken is bound rather than created",
    routes: nativeHttpRoutes,
    schemas: {
      publicMutation: z.toJSONSchema(publicMutationSchema),
      configurationCreation: z.toJSONSchema(configurationCreationSchema),
      repositoryConfigurationImport: z.toJSONSchema(
        repositoryConfigurationImportSchema,
      ),
      draftCreation: z.toJSONSchema(draftCreationSchema),
      draftRevision: z.toJSONSchema(draftRevisionSchema),
      forgeCredential: z.toJSONSchema(forgeCredentialRequestSchema),
      forgeInstallationClaim: z.toJSONSchema(forgeInstallationClaimSchema),
      projectRepositoryBind: z.toJSONSchema(projectRepositoryBindSchema),
      projectRepositoryCreate: z.toJSONSchema(projectRepositoryCreateSchema),
      leadInquiry: z.toJSONSchema(leadInquirySchema),
      selectorProjectSettings: z.toJSONSchema(selectorProjectSettingsSchema),
      threadMessage: z.toJSONSchema(threadMessageSchema),
      threadRename: z.toJSONSchema(threadRenameRequestSchema),
      threadHide: z.toJSONSchema(threadHideRequestSchema),
    },
  };
}
