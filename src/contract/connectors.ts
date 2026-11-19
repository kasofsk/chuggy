/**
 * A project's connectors: the integrations its jobs may be issued, each named
 * by its administrator and holding the provider settings that integration
 * reads. A connector never holds a secret.
 *
 * A SETTING NEVER READS AS A PLACEHOLDER. A worker fills `{{file:<name>}}` in
 * the values a credential hands it, so no identifier holds `{` or `}`.
 */

import { z } from "zod";

/** Every kind of connector, each the integration its settings configure. */
export const connectorKinds = ["Aws", "Gcp", "Azure", "Anthropic"] as const;
export type ConnectorKind = (typeof connectorKinds)[number];

/** The longest connector name. */
export const connectorNameCharsMax = 40;

/** Lower-case letters, digits and inner hyphens, beginning and ending with a letter or digit, to the longest name. */
export const connectorNamePattern = new RegExp(
  `^(?=.{1,${String(connectorNameCharsMax)}}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`,
  "u",
);

/** Whether `value` is a connector's name. */
export function isConnectorName(value: string): boolean {
  return connectorNamePattern.test(value);
}

export const connectorNameSchema = z.string().refine(isConnectorName, {
  message: `a connector name is at most ${String(connectorNameCharsMax)} lower-case letters, digits and inner hyphens`,
});

/** The most connectors one project holds. */
export const connectorsProjectMax = 32;

/** The most changes one page of a project's connector history answers. */
export const connectorChangesPageMax = 100;

/** The longest identifier a setting holds, but an AWS role's ARN. */
export const connectorIdentifierCharsMax = 256;

/** The longest AWS role ARN. */
export const connectorRoleArnCharsMax = 2048;

/** Printable ASCII but whitespace, `{` and `}`. */
const connectorIdentifierPattern = /^[!-z|~]+$/u;

/** A non-secret identifier a provider names something by. */
function connectorIdentifierSchema(charsMax: number) {
  return z.string().min(1).max(charsMax).regex(connectorIdentifierPattern);
}

export const awsConnectorSettingsSchema = z.strictObject({
  roleArn: connectorIdentifierSchema(connectorRoleArnCharsMax).startsWith(
    "arn:",
  ),
  /** Whether the job's token carries AWS session tags; absent is off. */
  sessionTags: z.boolean().exactOptional(),
});

export const gcpConnectorSettingsSchema = z.strictObject({
  projectNumber: connectorIdentifierSchema(connectorIdentifierCharsMax).regex(
    /^[0-9]+$/u,
  ),
  pool: connectorIdentifierSchema(connectorIdentifierCharsMax),
  provider: connectorIdentifierSchema(connectorIdentifierCharsMax),
  serviceAccount: z
    .email()
    .max(connectorIdentifierCharsMax)
    .regex(connectorIdentifierPattern)
    .exactOptional(),
});

export const azureConnectorSettingsSchema = z.strictObject({
  tenantId: connectorIdentifierSchema(connectorIdentifierCharsMax),
  clientId: connectorIdentifierSchema(connectorIdentifierCharsMax),
});

export const anthropicConnectorSettingsSchema = z.strictObject({
  organizationId: connectorIdentifierSchema(connectorIdentifierCharsMax),
  federationRuleId: connectorIdentifierSchema(connectorIdentifierCharsMax),
  serviceAccountId: connectorIdentifierSchema(
    connectorIdentifierCharsMax,
  ).exactOptional(),
  workspaceId: connectorIdentifierSchema(
    connectorIdentifierCharsMax,
  ).exactOptional(),
});

/** Each kind's settings. */
export const connectorSettingsSchemas = {
  Aws: awsConnectorSettingsSchema,
  Gcp: gcpConnectorSettingsSchema,
  Azure: azureConnectorSettingsSchema,
  Anthropic: anthropicConnectorSettingsSchema,
} as const satisfies Record<ConnectorKind, z.ZodType>;

/** One variant per kind, each holding that kind's settings beside `shape`. */
export function connectorVariants<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.discriminatedUnion("kind", [
    z.strictObject({
      ...shape,
      kind: z.literal("Aws"),
      settings: awsConnectorSettingsSchema,
    }),
    z.strictObject({
      ...shape,
      kind: z.literal("Gcp"),
      settings: gcpConnectorSettingsSchema,
    }),
    z.strictObject({
      ...shape,
      kind: z.literal("Azure"),
      settings: azureConnectorSettingsSchema,
    }),
    z.strictObject({
      ...shape,
      kind: z.literal("Anthropic"),
      settings: anthropicConnectorSettingsSchema,
    }),
  ]);
}

/** One connector, whose settings are its kind's. */
export const connectorSchema = connectorVariants({ name: connectorNameSchema });
export type Connector = z.infer<typeof connectorSchema>;
