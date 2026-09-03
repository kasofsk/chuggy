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
  leadInquirySchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
  selectorProjectSettingsSchema,
  threadMessageSchema,
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
    routes: nativeHttpRoutes,
    schemas: {
      publicMutation: z.toJSONSchema(publicMutationSchema),
      configurationCreation: z.toJSONSchema(configurationCreationSchema),
      repositoryConfigurationImport: z.toJSONSchema(
        repositoryConfigurationImportSchema,
      ),
      draftCreation: z.toJSONSchema(draftCreationSchema),
      draftRevision: z.toJSONSchema(draftRevisionSchema),
      leadInquiry: z.toJSONSchema(leadInquirySchema),
      selectorProjectSettings: z.toJSONSchema(selectorProjectSettingsSchema),
      threadMessage: z.toJSONSchema(threadMessageSchema),
    },
  };
}
