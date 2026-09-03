/**
 * The administrative command that opens an agent session, gives it a turn and
 * closes it.
 *
 * NO RUNTIME ROLE MAY OPEN A SESSION, and that is deliberate: a session is an
 * authority to act as a principal, so minting one is provisioning rather than
 * work. This connects as the identity that owns the boundary — the same one
 * that migrates — exactly as `./provisionProjectAccess.ts` does, and the
 * precondition is checked as a privilege rather than as a role name, because a
 * deployment answering it with some other identity is answering it correctly.
 *
 * THE ACCOUNT AND CLUSTER ARE NOT ARGUMENTS. The server draws them from the
 * project's own capacity account, so this command cannot name another
 * project's entitlement for a session to spend.
 */

import { postgresAgentSessions } from "../adapters/postgres/agentSession.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import type {
  AgentSessionOpening,
  AgentSessionStore,
  SessionTurnOffering,
} from "../interpreter/agentSession.ts";
import {
  allSessionCapabilities,
  allSessionKinds,
  allSessionTurnInputKinds,
  asSessionId,
  asSessionTurnId,
  sessionCapabilitiesMax,
  type SessionCapability,
  type SessionKind,
  type SessionTurnInputKind,
} from "../interpreter/agentSession.ts";
import { asPrincipal, oidcPrincipal } from "../interpreter/principal.ts";
import { asProjectId, asTenantId } from "../interpreter/projectStore.ts";

const variables = {
  databaseUrl: "CHUG_PROVISION_SESSION_DATABASE_URL",
  action: "CHUG_PROVISION_SESSION_ACTION",
  tenant: "CHUG_PROVISION_SESSION_TENANT",
  project: "CHUG_PROVISION_SESSION_PROJECT",
  session: "CHUG_PROVISION_SESSION_SESSION",
  kind: "CHUG_PROVISION_SESSION_KIND",
  principal: "CHUG_PROVISION_SESSION_PRINCIPAL",
  issuer: "CHUG_PROVISION_SESSION_ISSUER",
  subject: "CHUG_PROVISION_SESSION_SUBJECT",
  parent: "CHUG_PROVISION_SESSION_PARENT",
  capabilities: "CHUG_PROVISION_SESSION_CAPABILITIES",
  credentialSlot: "CHUG_PROVISION_SESSION_CREDENTIAL_SLOT",
  systemPrompt: "CHUG_PROVISION_SESSION_SYSTEM_PROMPT",
  turn: "CHUG_PROVISION_SESSION_TURN",
  inputKind: "CHUG_PROVISION_SESSION_INPUT_KIND",
  input: "CHUG_PROVISION_SESSION_INPUT",
} as const;

/** The three things this command does, one of which every run names. */
const actions = ["open", "enqueue", "close"] as const;
type ProvisionSessionAction = (typeof actions)[number];

export type ProvisionSessionEnvironment = Readonly<
  Record<string, string | undefined>
>;

function required(
  environment: ProvisionSessionEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** Narrows an offered value to a roster, naming the variable that carried it. */
function member<Member extends string>(
  roster: readonly Member[],
  value: string,
  name: string,
): Member {
  const found = roster.find((known) => known === value);
  if (found === undefined)
    throw new Error(`${name} must be one of ${roster.join(", ")}`);
  return found;
}

function provisionAction(
  environment: ProvisionSessionEnvironment,
): ProvisionSessionAction {
  return member(
    actions,
    required(environment, variables.action),
    variables.action,
  );
}

/** The capability roster a session is opened with, bounded as the row is. */
function provisionCapabilities(
  environment: ProvisionSessionEnvironment,
): readonly SessionCapability[] {
  const offered = required(environment, variables.capabilities)
    .split(",")
    .filter((value) => value.length > 0);
  if (offered.length > sessionCapabilitiesMax)
    throw new Error(
      `${variables.capabilities} names more capabilities than a session may hold`,
    );
  return offered.map((value) =>
    member<SessionCapability>(
      allSessionCapabilities,
      value,
      variables.capabilities,
    ),
  );
}

/**
 * Whose authority the session acts under, derived from the issuer and subject a
 * membership is derived from or given already encoded — because a typed
 * principal one character from the derived one authenticates and is then
 * refused `NotFound` on every project call, with nothing saying why.
 */
function provisionPrincipal(environment: ProvisionSessionEnvironment) {
  const encoded = environment[variables.principal];
  const issuer = environment[variables.issuer];
  const subject = environment[variables.subject];
  const derived = issuer !== undefined || subject !== undefined;
  if (derived && encoded !== undefined && encoded.length > 0)
    throw new Error(
      `name either ${variables.principal} or ${variables.issuer} with ${variables.subject}, not both`,
    );
  if (!derived) return asPrincipal(required(environment, variables.principal));
  return oidcPrincipal(
    required(environment, variables.issuer),
    required(environment, variables.subject),
  );
}

function provisionPartition(environment: ProvisionSessionEnvironment) {
  return {
    tenant: asTenantId(required(environment, variables.tenant)),
    project: asProjectId(required(environment, variables.project)),
  };
}

export function provisionSessionOpening(
  environment: ProvisionSessionEnvironment,
): AgentSessionOpening {
  const parent = environment[variables.parent];
  const prompt = environment[variables.systemPrompt];
  return {
    partition: provisionPartition(environment),
    session: asSessionId(required(environment, variables.session)),
    kind: member<SessionKind>(
      allSessionKinds,
      required(environment, variables.kind),
      variables.kind,
    ),
    principal: provisionPrincipal(environment),
    ...(parent === undefined || parent.length === 0
      ? {}
      : { parent: asSessionId(parent) }),
    capabilities: provisionCapabilities(environment),
    credentialSlot: required(environment, variables.credentialSlot),
    ...(prompt === undefined || prompt.length === 0
      ? {}
      : { systemPrompt: prompt }),
  };
}

export function provisionSessionOffering(
  environment: ProvisionSessionEnvironment,
): SessionTurnOffering {
  return {
    partition: provisionPartition(environment),
    session: asSessionId(required(environment, variables.session)),
    turn: asSessionTurnId(required(environment, variables.turn)),
    inputKind: member<SessionTurnInputKind>(
      allSessionTurnInputKinds,
      required(environment, variables.inputKind),
      variables.inputKind,
    ),
    input: required(environment, variables.input),
  };
}

/** Refuses an identity that cannot open a session, naming what a deployment must supply. */
async function provisionPrecondition(store: AgentSessionStore): Promise<void> {
  const writer = await store.writer();
  if (!writer.canExecute)
    throw new Error(
      `${writer.role} cannot execute open_agent_session; ${variables.databaseUrl} must name the identity that owns it`,
    );
}

export async function provisionSessionRun(input: {
  readonly environment: ProvisionSessionEnvironment;
  readonly store: AgentSessionStore;
}): Promise<string> {
  const action = provisionAction(input.environment);
  await provisionPrecondition(input.store);
  if (action === "open") {
    const opening = provisionSessionOpening(input.environment);
    const opened = await input.store.open(opening);
    if (opened === "Conflict")
      throw new Error(
        `Conflict: ${opening.partition.tenant}/${opening.partition.project} already holds a session this one would contradict`,
      );
    return `${opened}: ${opening.kind} session ${opening.session} for ${opening.principal}`;
  }
  if (action === "enqueue") {
    const offering = provisionSessionOffering(input.environment);
    const enqueued = await input.store.enqueue(offering);
    if (
      enqueued.enqueued === "Enqueued" ||
      enqueued.enqueued === "AlreadyEnqueued"
    )
      return `${enqueued.enqueued}: turn ${offering.turn} of session ${offering.session} at ordinal ${String(enqueued.ordinal)}`;
    throw new Error(
      `${enqueued.enqueued}: session ${offering.session} took no turn`,
    );
  }
  const partition = provisionPartition(input.environment);
  const session = asSessionId(required(input.environment, variables.session));
  const closed = await input.store.close(partition, session);
  return closed
    ? `Closed: session ${session}, and every turn it had not finished is abandoned`
    : `AlreadyClosed: session ${session} was not open`;
}

async function main(environment: ProvisionSessionEnvironment): Promise<void> {
  const pool = postgresPool(required(environment, variables.databaseUrl));
  try {
    process.stdout.write(
      `${await provisionSessionRun({ environment, store: postgresAgentSessions(pool) })}\n`,
    );
  } finally {
    await pool.end();
  }
}

await main(process.env).catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown provisioning failure";
  process.stderr.write(`provision agent session: ${message}\n`);
  process.exitCode = 1;
});
