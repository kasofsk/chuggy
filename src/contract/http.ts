/**
 * The versioned public HTTP wire: its routes, its bounds, its error envelope
 * and the primitive schemas every request and response is built from.
 *
 * `src/contract/` depends on `zod` and on nothing else, so the server and a
 * browser hold one copy of the contract rather than two that drift.
 */

import { z } from "zod";

export const nativeHttpVersion = 1;
export const nativeHttpBasePath = "/api/v1";
export const nativeHttpMediaType = "application/vnd.chuggy.v1+json";
export const nativeHttpBodyBytesMax = 65_536;
export const nativeHttpHeaderBytesMax = 16_384;
export const nativeHttpCursorCharsMax = 2_048;
export const nativeHttpPathSegmentCharsMax = 256;

/** The largest page any collection route answers with, and the size it assumes. */
export const nativeHttpPageItemsMax = 100;
export const nativeHttpPageItemsDefault = 50;

/** The version a dispatch view token carries, so a stale reader is refused. */
export const dispatchViewSchemaVersion = 1;

export const nativeHttpRoutes = {
  contract: `${nativeHttpBasePath}/contract`,
  installation: `${nativeHttpBasePath}/installation`,
  projects: `${nativeHttpBasePath}/projects`,
  project: `${nativeHttpBasePath}/tenants/:tenant/projects/:project`,
  tickets: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets`,
  ticket: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets/:ticket`,
  operationalStatus: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operational-status`,
  selectorContext: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-context`,
  executions: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions`,
  execution: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution`,
  outputContent: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/artifacts/:ordinal`,
  operations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations`,
  operation: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations/:operation`,
  notifications: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/notifications`,
  configurations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations`,
  configurationImports: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/imports`,
  configuration: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/:revision`,
  drafts: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts`,
  draftInitialization: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/draft-initializations/:revision`,
  draft: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts/:ticket`,
  dispatchView: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/dispatch-view`,
} as const;

export type NativeHttpRoute = keyof typeof nativeHttpRoutes;

/** An opaque identity the wire carries in a path segment or a body field. */
export const identitySchema = z
  .string()
  .min(1)
  .max(nativeHttpPathSegmentCharsMax);

export const countSchema = z.number().int().safe().nonnegative();
export const ticketNumberSchema = z.number().int().safe().positive();
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const instantSchema = z.string().min(1);
export const cursorSchema = z.string().min(1).max(nativeHttpCursorCharsMax);

export const partitionSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
});

export type PartitionIdentity = z.infer<typeof partitionSchema>;

export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/** The envelope alone; a status that carries more sends it beside this. */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: identitySchema, message: z.string() }),
});

export function nativeHttpError(
  code: string,
  message: string,
): HttpErrorEnvelope {
  return { error: { code, message } };
}

/** The path prefix every project-scoped resource hangs from. */
export function partitionPath(partition: PartitionIdentity): string {
  const tenant = encodeURIComponent(partition.tenant);
  const project = encodeURIComponent(partition.project);
  if (
    tenant.length > nativeHttpPathSegmentCharsMax ||
    project.length > nativeHttpPathSegmentCharsMax
  )
    throw new RangeError("a partition segment is longer than the wire accepts");
  return `${nativeHttpBasePath}/tenants/${tenant}/projects/${project}`;
}
