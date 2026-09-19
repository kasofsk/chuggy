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
  forgeCredentialRequestSchema,
  forgeInstallationClaimSchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  projectRepositoryRetirementSchema,
} from "./requests.ts";

/** Every request body the document publishes, as the JSON Schema its own parser induces. */
function nativeHttpContractDocumentSchemas(): unknown {
  return {
    forgeCredential: z.toJSONSchema(forgeCredentialRequestSchema),
    forgeInstallationClaim: z.toJSONSchema(forgeInstallationClaimSchema),
    projectRepositoryBind: z.toJSONSchema(projectRepositoryBindSchema),
    projectRepositoryCreate: z.toJSONSchema(projectRepositoryCreateSchema),
    projectRepositoryLanding: z.toJSONSchema(projectRepositoryLandingSchema),
    projectRepositoryRetirement: z.toJSONSchema(
      projectRepositoryRetirementSchema,
    ),
    leadInquiry: z.toJSONSchema(nativeHttpEndpoints.askLead.body),
    threadMessage: z.toJSONSchema(nativeHttpEndpoints.sendThreadMessage.body),
    threadRename: z.toJSONSchema(nativeHttpEndpoints.renameThread.body),
    threadHide: z.toJSONSchema(nativeHttpEndpoints.hideThread.body),
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
        "a session bearer authorizes as the session's principal and is recorded on the operation",
    },
    caching: "no-store",
    cors: "same-origin",
    credentials: "authorization bearer header; no cookies",
    identities: {
      installation: "canonical UUID authority identity",
      tenant: "percent-encoded opaque UTF-8 path segment",
      project: "percent-encoded opaque UTF-8 path segment",
      cursor: "opaque canonical base64url",
    },
    forgeInstallations:
      "a tenant's administrator claims an installation of this deployment's app; an installation another tenant holds is a conflict, and a claim is never released",
    repositoryBinding:
      "binding a repository to a project creates no project: a project that does not exist is not found, and the repository must be one this deployment holds a credential for — on a host it mints for, that means an installation this tenant has claimed",
    repositoryLanding:
      "a repository's landing default is written against the value the writer read",
    repositoryRetirement:
      "a retired repository stays bound and stays readable by name, and stops being the one a session is placed against, the importer reads or a brief may name; this route only retires and repeating it changes nothing, and binding the repository again reinstates it",
    repositoryCreation:
      "creating a repository requires this tenant's claims of both apps on the account; the repository is the forge's from the moment it answers, so a later refusal is reported beside one that stands and a name already taken is bound rather than created",
    routes: nativeHttpRoutes,
    schemas: nativeHttpContractDocumentSchemas(),
  };
}
