/**
 * The `InvalidRequest` bodies the API answers a connector write with, made
 * from the contract's own schemas as the server makes them: each issue one
 * line, its path joined by dots before its message, one without a path its
 * message alone. The name is parsed from the address before the body, so a
 * refused name is the one line its schema says.
 */

import { connectorNameSchema } from "../../../../src/contract/connectors.ts";
import { connectorWriteRequestSchema } from "../../../../src/contract/connectorAdministration.ts";
import type { z } from "zod";

function connectorRefusalBody(issues: readonly z.core.$ZodIssue[]): unknown {
  return {
    error: {
      code: "InvalidRequest",
      message: issues
        .map((issue) => {
          const at = issue.path.join(".");
          return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
        })
        .join("\n"),
    },
  };
}

export function connectorInvalidNameBody(name: string): unknown {
  const read = connectorNameSchema.safeParse(name);
  if (read.success) throw new Error(`${name} is a connector name`);
  return connectorRefusalBody(read.error.issues);
}

export function connectorInvalidSettingsBody(written: unknown): unknown {
  const read = connectorWriteRequestSchema.safeParse(written);
  if (read.success) throw new Error("the write is one the contract takes");
  return connectorRefusalBody(read.error.issues);
}
