/**
 * `AccessTupleReader` over Ory Keto's read API: one page of a listing per call,
 * the next asked for with the token the last one answered.
 *
 * A PAGE IS SIZED SO THE WIDEST ONE FITS `ketoResponseBytesMax`. A page past
 * that bound is an outage on every retry rather than a list cut short, so the
 * size is derived from the widest tuple this tree writes — a tenant and a
 * project each as long as a path segment carries, every character escaped —
 * rather than chosen.
 *
 * A SUBJECT SET IS NO PRINCIPAL, and is answered as one so the interpreter can
 * tell a `tenant` link from a person rather than reading its object as a name.
 * Its relation is kept, which is what tells a link from the holders of a role.
 */

import { z } from "zod";

import { nativeHttpPathSegmentCharsMax } from "../../contract/http.ts";
import type {
  AccessTuple,
  AccessTupleQuery,
  AccessTupleReader,
} from "../../interpreter/accessPlane.ts";
import { principalCharsMax } from "../../interpreter/principal.ts";
import {
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccessSettings,
} from "../../interpreter/projectAccess.ts";
import { projectTenantRelation } from "../../interpreter/projectGrant.ts";
import { ketoTuplesPath } from "./projectAccess.ts";
import { ketoSubjectSetRelation } from "./projectGrants.ts";
import { ketoRequest, ketoResponseBytesMax } from "./request.ts";

/** The most one UTF-16 unit weighs in the authority's JSON, which is a `\u` escape. */
const ketoEscapedUnitBytesMax = 6;

/** What a tuple or a page weighs apart from its texts: keys, quotes, separators, namespaces and relations. */
const ketoFixedBytesMax = 512;

/** The longest object a tuple names, a project's: a length, a colon, a tenant and a project. */
const ketoObjectUnitsMax =
  String(nativeHttpPathSegmentCharsMax).length +
  1 +
  2 * nativeHttpPathSegmentCharsMax;

/** The longest subject: a principal, or a project's object named by a subject set. */
const ketoSubjectUnitsMax = Math.max(principalCharsMax, ketoObjectUnitsMax);

/** The most one tuple weighs, which also bounds the page token beside it. */
export const ketoTupleBytesMax =
  ketoFixedBytesMax +
  ketoEscapedUnitBytesMax * (ketoObjectUnitsMax + ketoSubjectUnitsMax);

/** How many tuples one page is asked for, the most whose widest page and token fit the bound. */
export const ketoAccessPageTuplesMax = Math.floor(
  (ketoResponseBytesMax - ketoFixedBytesMax - ketoTupleBytesMax) /
    ketoTupleBytesMax,
);

const ketoTupleSchema = z.object({
  object: z.string(),
  relation: z.string(),
  subject_id: z.string().optional(),
  subject_set: z
    .object({ namespace: z.string(), object: z.string(), relation: z.string() })
    .optional(),
});

const ketoPageSchema = z.object({
  relation_tuples: z.array(ketoTupleSchema),
  next_page_token: z.string().optional(),
});

/** The query a listing is asked with, apart from its page. */
function ketoAccessQuery(
  query: AccessTupleQuery,
): Readonly<Record<string, string>> {
  switch (query.query) {
    case "Object":
      return {
        namespace: query.namespace,
        object: query.object,
        ...(query.relation === undefined ? {} : { relation: query.relation }),
      };
    case "TenantProjects":
      return {
        namespace: projectAccessNamespace,
        relation: projectTenantRelation,
        "subject_set.namespace": projectAccessTenantNamespace,
        "subject_set.object": projectAccessTenantObject(query.tenant),
        "subject_set.relation": ketoSubjectSetRelation,
      };
    case "Namespace":
      return { namespace: query.namespace };
  }
}

function ketoAccessTuple(tuple: z.infer<typeof ketoTupleSchema>): AccessTuple {
  if (tuple.subject_id !== undefined)
    return {
      object: tuple.object,
      relation: tuple.relation,
      subject: { subject: "Id", id: tuple.subject_id },
    };
  if (tuple.subject_set !== undefined)
    return {
      object: tuple.object,
      relation: tuple.relation,
      subject: {
        subject: "Set",
        namespace: tuple.subject_set.namespace,
        object: tuple.subject_set.object,
        relation: tuple.subject_set.relation,
      },
    };
  throw new ProjectAccessUnavailable("a listed tuple named no subject");
}

export function ketoAccessTuples(
  settings: ProjectAccessSettings,
  fetcher: typeof fetch = fetch,
): AccessTupleReader {
  return {
    page: async (query, token) => {
      const url = new URL(ketoTuplesPath, settings.readUrl);
      for (const [name, value] of Object.entries(ketoAccessQuery(query)))
        url.searchParams.set(name, value);
      url.searchParams.set("page_size", String(ketoAccessPageTuplesMax));
      if (token !== undefined) url.searchParams.set("page_token", token);
      const page = ketoPageSchema.safeParse(
        await ketoRequest({
          url,
          method: "GET",
          requestTimeoutMs: settings.requestTimeoutMs,
          fetcher,
        }),
      );
      if (!page.success)
        throw new ProjectAccessUnavailable(
          "the tuple listing answered no page",
        );
      return {
        tuples: page.data.relation_tuples.map(ketoAccessTuple),
        next: page.data.next_page_token,
      };
    },
  };
}
