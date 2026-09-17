/** Runtime validation for the surviving shared HTTP representations. */

import { errorEnvelopeSchema } from "../../contract/http.ts";
import { projectInventoryResponseSchema as projectInventoryWireSchema } from "../../contract/responses.ts";
import type { ProjectInventoryPage } from "../../interpreter/nativeWeb.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { parseInventoryCursor } from "./contract.ts";

export const errorResponseSchema = errorEnvelopeSchema;

export const projectInventoryResponseSchema =
  projectInventoryWireSchema.transform((value): ProjectInventoryPage => ({
    projects: value.projects.map((project) => ({
      tenant: asTenantId(project.tenant),
      project: asProjectId(project.project),
    })),
    ...(value.nextCursor === undefined
      ? {}
      : { nextAfter: parseInventoryCursor(value.nextCursor) }),
  }));

export function encodeProjectInventoryResponse(value: unknown): unknown {
  return projectInventoryWireSchema.parse(value);
}
