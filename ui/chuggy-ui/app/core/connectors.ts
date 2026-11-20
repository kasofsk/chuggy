/**
 * A project's connectors, decided with no renderer: each kind's fields, what a
 * form holds and the write it sends, what is wrong with it before it is sent,
 * and what a refused write says and where.
 *
 * THE CONTRACT DECIDES WHAT A FORM MAY HOLD. Whether a field is required, and
 * whether what was typed is a value of it, is asked of the contract's own
 * schemas; this module only says which field each fault is beside.
 *
 * A KIND IS GIVEN ITS FIELDS HERE OR DOES NOT COMPILE. `connectorFields` is
 * keyed by the contract's kinds and by each kind's settings, so a kind or a
 * setting the contract gains is a type error until it is labelled.
 */

import type { z } from "zod";

import {
  connectorKinds,
  connectorNameCharsMax,
  connectorNameSchema,
  connectorSettingsSchemas,
  connectorsProjectMax,
  isConnectorName,
} from "../../../../src/contract/connectors.ts";
import type { ConnectorKind } from "../../../../src/contract/connectors.ts";
import {
  connectorLimitReachedCode,
  connectorStaleCode,
  connectorStaleResponseSchema,
  connectorWriteRequestSchema,
} from "../../../../src/contract/connectorAdministration.ts";
import type {
  ConnectorChangeResponse,
  ConnectorStandingResponse,
  ConnectorWriteRequest,
} from "../../../../src/contract/connectorAdministration.ts";
import { errorEnvelopeSchema } from "../../../../src/contract/http.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import { failureWords } from "./failureWords.ts";

/** A setting typed as text, and the line drawn beside it when the contract refuses what was typed. */
export interface ConnectorTextField {
  readonly control: "Text";
  readonly label: Copy;
  readonly fault: Copy;
}

/** A setting that is on or off, and the line that says what turning it on costs. */
export interface ConnectorSwitchField {
  readonly control: "Switch";
  readonly label: Copy;
  readonly about: Copy;
  readonly cost: Copy;
}

export type ConnectorField = ConnectorTextField | ConnectorSwitchField;

type ConnectorSettingsOf<Kind extends ConnectorKind> = z.infer<
  (typeof connectorSettingsSchemas)[Kind]
>;

type ConnectorFieldOf<Value> = [NonNullable<Value>] extends [boolean]
  ? ConnectorSwitchField
  : ConnectorTextField;

type ConnectorFieldsOf<Kind extends ConnectorKind> = {
  readonly [Setting in keyof ConnectorSettingsOf<Kind>]-?: ConnectorFieldOf<
    ConnectorSettingsOf<Kind>[Setting]
  >;
};

const connectorIdentifierFault: Copy = { id: "connectors-fault-identifier" };

function connectorText(label: Copy, fault = connectorIdentifierFault) {
  return { control: "Text", label, fault } as const;
}

/** Each kind's settings, in the order its form draws them. */
export const connectorFields: {
  readonly [Kind in ConnectorKind]: ConnectorFieldsOf<Kind>;
} = {
  Aws: {
    roleArn: connectorText(
      { id: "connectors-field-role-arn" },
      { id: "connectors-fault-role-arn" },
    ),
    sessionTags: {
      control: "Switch",
      label: { id: "connectors-field-session-tags" },
      about: { id: "connectors-session-tags-about" },
      cost: { id: "connectors-session-tags-cost" },
    },
  },
  Gcp: {
    projectNumber: connectorText(
      { id: "connectors-field-project-number" },
      { id: "connectors-fault-project-number" },
    ),
    pool: connectorText({ id: "connectors-field-pool" }),
    provider: connectorText({ id: "connectors-field-provider" }),
    serviceAccount: connectorText(
      { id: "connectors-field-service-account" },
      { id: "connectors-fault-email" },
    ),
  },
  Azure: {
    tenantId: connectorText({ id: "connectors-field-tenant-id" }),
    clientId: connectorText({ id: "connectors-field-client-id" }),
  },
  Anthropic: {
    organizationId: connectorText({ id: "connectors-field-organization-id" }),
    federationRuleId: connectorText({
      id: "connectors-field-federation-rule-id",
    }),
    serviceAccountId: connectorText({
      id: "connectors-field-service-account-id",
    }),
    workspaceId: connectorText({ id: "connectors-field-workspace-id" }),
  },
};

/** One kind as its choice and its list entry name it. */
export function connectorKindLabel(kind: ConnectorKind): Copy {
  switch (kind) {
    case "Aws":
      return { id: "connectors-kind-aws" };
    case "Gcp":
      return { id: "connectors-kind-gcp" };
    case "Azure":
      return { id: "connectors-kind-azure" };
    case "Anthropic":
      return { id: "connectors-kind-anthropic" };
  }
}

/** One of a kind's settings, and whether the contract requires it. */
export interface ConnectorFieldListed {
  readonly setting: string;
  readonly field: ConnectorField;
  readonly required: boolean;
}

/** The settings the contract refuses to go without, as it says of settings holding none. */
function connectorSettingsRequired(kind: ConnectorKind): ReadonlySet<string> {
  const read = connectorSettingsSchemas[kind].safeParse({});
  if (read.success) return new Set();
  return new Set(
    read.error.issues.flatMap((issue) =>
      issue.path.length === 1 ? [String(issue.path[0])] : [],
    ),
  );
}

/** A kind's settings, in its form's order. */
export function connectorFieldsOf(
  kind: ConnectorKind,
): readonly ConnectorFieldListed[] {
  const required = connectorSettingsRequired(kind);
  const fields: Readonly<Record<string, ConnectorField>> =
    connectorFields[kind];
  return Object.entries(fields).map(([setting, field]) => ({
    setting,
    field,
    required: required.has(setting),
  }));
}

/** What a connector's form holds: every kind's text and switches, so choosing
 * another kind and back loses nothing typed. */
export interface ConnectorDraft {
  readonly name: string;
  readonly kind: ConnectorKind;
  readonly texts: Readonly<Record<string, string>>;
  readonly switches: Readonly<Record<string, boolean>>;
  /** The revision a change was read at; absent for a new connector. */
  readonly revision: number | undefined;
}

/** What every Add starts from: no name, the first kind, nothing typed, every switch off. */
export const connectorDraftBlank: ConnectorDraft = {
  name: "",
  kind: connectorKinds[0],
  texts: {},
  switches: {},
  revision: undefined,
};

/** A connector as it stands, as the form that changes it starts. */
export function connectorDraftOf(
  connector: ConnectorStandingResponse,
): ConnectorDraft {
  const texts: Record<string, string> = {};
  const switches: Record<string, boolean> = {};
  for (const [setting, value] of Object.entries(connector.settings))
    if (typeof value === "boolean") switches[setting] = value;
    else texts[setting] = value;
  return {
    name: connector.name,
    kind: connector.kind,
    texts,
    switches,
    revision: connector.revision,
  };
}

/** The draft's settings for its kind: a blank text left out, a switch only where it is on. */
function connectorDraftSettings(
  draft: ConnectorDraft,
): Record<string, string | true> {
  const settings: Record<string, string | true> = {};
  for (const { setting, field } of connectorFieldsOf(draft.kind)) {
    if (field.control === "Switch") {
      if (draft.switches[setting] === true) settings[setting] = true;
      continue;
    }
    const typed = (draft.texts[setting] ?? "").trim();
    if (typed !== "") settings[setting] = typed;
  }
  return settings;
}

function connectorDraftBody(draft: ConnectorDraft): unknown {
  return {
    kind: draft.kind,
    settings: connectorDraftSettings(draft),
    ...(draft.revision === undefined
      ? {}
      : { expectedRevision: draft.revision }),
  };
}

/** The name the draft writes under. */
export function connectorDraftName(draft: ConnectorDraft): string {
  return draft.name.trim();
}

/** The write the draft sends, or nothing where the contract would refuse it. */
export function connectorWriteOf(
  draft: ConnectorDraft,
): ConnectorWriteRequest | undefined {
  if (!isConnectorName(connectorDraftName(draft))) return undefined;
  const read = connectorWriteRequestSchema.safeParse(connectorDraftBody(draft));
  return read.success ? read.data : undefined;
}

/** What is wrong with a form, each beside the field it concerns; `form` is what concerns none. */
export interface ConnectorFaults {
  readonly name: Copy | undefined;
  readonly settings: Readonly<Record<string, Copy>>;
  readonly form: Copy | undefined;
}

export const connectorFaultsNone: ConnectorFaults = {
  name: undefined,
  settings: {},
  form: undefined,
};

const connectorNameFault: Copy = {
  id: "connectors-fault-name",
  args: { chars: connectorNameCharsMax },
};

function connectorSettingFault(
  kind: ConnectorKind,
  setting: string,
): Copy | undefined {
  const fields: Readonly<Record<string, ConnectorField | undefined>> =
    connectorFields[kind];
  const field = fields[setting];
  return field?.control === "Text" ? field.fault : undefined;
}

/** What is wrong with what was typed, as the contract judges it; a field left
 * blank says nothing until something is typed there, and only keeps the write
 * from being sent. */
export function connectorDraftFaults(draft: ConnectorDraft): ConnectorFaults {
  const name = connectorDraftName(draft);
  const settings: Record<string, Copy> = {};
  const read = connectorWriteRequestSchema.safeParse(connectorDraftBody(draft));
  if (!read.success)
    for (const issue of read.error.issues) {
      const [at, setting] = issue.path;
      if (at !== "settings" || typeof setting !== "string") continue;
      if ((draft.texts[setting] ?? "").trim() === "") continue;
      const fault = connectorSettingFault(draft.kind, setting);
      if (fault !== undefined) settings[setting] = fault;
    }
  return {
    name: name === "" || isConnectorName(name) ? undefined : connectorNameFault,
    settings,
    form: undefined,
  };
}

/** The message the contract refuses a name with, which a refusal of one carries as its own line. */
const connectorNameRefusedLine =
  connectorNameSchema.safeParse("").error?.issues[0]?.message;

/** A shape fault's lines, each beside the field its path names. */
function connectorShapeFaults(
  body: unknown,
  kind: ConnectorKind,
): ConnectorFaults {
  const read = errorEnvelopeSchema.safeParse(body);
  const lines = read.success ? read.data.error.message.split("\n") : [];
  const settings: Record<string, Copy> = {};
  let name: Copy | undefined;
  let form: Copy | undefined;
  for (const line of lines) {
    const setting = /^settings\.([A-Za-z]+): /u.exec(line)?.[1];
    const fault =
      setting === undefined ? undefined : connectorSettingFault(kind, setting);
    if (setting !== undefined && fault !== undefined) settings[setting] = fault;
    else if (line === connectorNameRefusedLine) name = connectorNameFault;
    else form = { id: "connectors-refused-shape" };
  }
  if (name === undefined && form === undefined && lines.length === 0)
    form = { id: "connectors-refused-shape" };
  return { name, settings, form };
}

/** Which refusal a write met, by the code the API answered. */
export function connectorWriteRefusedAs(
  failure: ApiFailure,
): "Stale" | "Limit" | "Shape" | "Other" {
  if (failure.outcome === "Conflict" && failure.code === connectorStaleCode)
    return "Stale";
  if (
    failure.outcome === "Conflict" &&
    failure.code === connectorLimitReachedCode
  )
    return "Limit";
  if (failure.outcome === "Rejected" && failure.code === "InvalidRequest")
    return "Shape";
  return "Other";
}

/** What a refused write is: a change the connector moved under, carrying the
 * revision that stands, or one whose fields are at fault, each beside its
 * field; any other has no more to it than its line. An add refused as stale
 * met a connector of its name already standing, which is its name's fault. */
export type ConnectorWriteRefusal =
  | { readonly refusal: "Stale"; readonly standing: number | undefined }
  | { readonly refusal: "Faults"; readonly faults: ConnectorFaults }
  | { readonly refusal: "Other" };

export function connectorWriteRefusal(
  failure: ApiFailure,
  sent: { readonly name: string; readonly kind: ConnectorKind },
  adding: boolean,
): ConnectorWriteRefusal {
  switch (connectorWriteRefusedAs(failure)) {
    case "Stale": {
      if (adding)
        return {
          refusal: "Faults",
          faults: {
            ...connectorFaultsNone,
            name: { id: "connectors-refused-taken", args: { name: sent.name } },
          },
        };
      const read = connectorStaleResponseSchema.safeParse(
        failure.outcome === "Conflict" ? failure.body : undefined,
      );
      return {
        refusal: "Stale",
        standing: read.success ? read.data.standing : undefined,
      };
    }
    case "Limit":
      return {
        refusal: "Faults",
        faults: {
          ...connectorFaultsNone,
          name: {
            id: "connectors-refused-limit",
            args: { count: connectorsProjectMax },
          },
        },
      };
    case "Shape":
      return {
        refusal: "Faults",
        faults: connectorShapeFaults(
          failure.outcome === "Rejected" ? failure.body : undefined,
          sent.kind,
        ),
      };
    case "Other":
      return { refusal: "Other" };
  }
}

/** The one line a refused write is drawn as, beside the form's actions; what
 * is wrong with a field is said beside it as well. */
export function connectorWriteRefusedLine(
  failure: ApiFailure,
  adding: boolean,
): Copy {
  switch (connectorWriteRefusedAs(failure)) {
    case "Stale":
      return adding
        ? { id: "connectors-refused-fields" }
        : { id: "connectors-refused-stale" };
    case "Limit":
    case "Shape":
      return { id: "connectors-refused-fields" };
    case "Other":
      return failureWords(failure).word;
  }
}

/** Whether a removal's refusal is that the connector is gone already, which
 * is what was asked and is said as nothing. */
export function connectorRemovalGone(failure: ApiFailure): boolean {
  return failure.outcome === "Absent";
}

/** The line a refused removal is drawn as under its row. */
export function connectorRemovalRefusal(failure: ApiFailure): Copy {
  if (failure.outcome === "Conflict" && failure.code === connectorStaleCode)
    return { id: "connectors-refused-stale-removal" };
  return failureWords(failure).word;
}

/** One setting as a list draws it: its label and its value, a switch as On or
 * Off, and a blank optional setting as not set. */
export interface ConnectorSettingShown {
  readonly setting: string;
  readonly label: Copy;
  readonly value: CopyOrData | undefined;
}

export function connectorSettingsShown(connector: {
  readonly kind: ConnectorKind;
  readonly settings: Readonly<Record<string, string | boolean>>;
}): readonly ConnectorSettingShown[] {
  return connectorFieldsOf(connector.kind).map(({ setting, field }) => {
    const value = connector.settings[setting];
    if (field.control === "Switch")
      return {
        setting,
        label: field.label,
        value:
          value === true
            ? { id: "connectors-switch-on" }
            : { id: "connectors-switch-off" },
      };
    return {
      setting,
      label: field.label,
      value: typeof value === "string" ? value : undefined,
    };
  });
}

/** What one change did, as its history row says it. */
export function connectorChangeLine(change: ConnectorChangeResponse): Copy {
  const args = { name: change.name };
  switch (change.action) {
    case "Created":
      return { id: "connectors-history-created", args };
    case "Changed":
      return { id: "connectors-history-changed", args };
    case "Removed":
      return { id: "connectors-history-removed", args };
  }
}
