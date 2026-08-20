import type pg from "pg";

import { postgresOperationInbox } from "./adapters/postgres/operationInbox.ts";
import { postgresNativeReads } from "./adapters/postgres/nativeReads.ts";
import { postgresProjectDecision } from "./adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "./adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "./adapters/postgres/projectStore.ts";
import type { IdempotencyKeying } from "./adapters/postgres/keying.ts";
import type { OperationInbox } from "./interpreter/operationInbox.ts";
import {
  nativeWeb,
  type NativeWeb,
  type ProjectAccess,
} from "./interpreter/nativeWeb.ts";
import type { ProjectDecision } from "./interpreter/projectDecision.ts";
import type { ProjectDiscovery } from "./interpreter/projectDiscovery.ts";
import type { ProjectStore } from "./interpreter/projectStore.ts";
import {
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "./interpreter/ticketService.ts";

export interface TicketService {
  readonly inbox: OperationInbox;
  readonly discovery: ProjectDiscovery;
  readonly decisions: ProjectDecision;
  readonly projects: ProjectStore;
}

/** Wires the authenticated web application to API-role PostgreSQL ports. */
export function composeNativeWeb(
  apiPool: pg.Pool,
  keying: IdempotencyKeying,
  access: ProjectAccess,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): NativeWeb {
  const inbox = postgresOperationInbox(apiPool, keying, config, metrics);
  return nativeWeb(access, postgresNativeReads(apiPool), inbox);
}

/** Wires the ticket-service contracts to separate API and writer credentials. */
export function composeTicketService(
  apiPool: pg.Pool,
  writerPool: pg.Pool,
  keying: IdempotencyKeying,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): TicketService {
  return {
    inbox: postgresOperationInbox(apiPool, keying, config, metrics),
    discovery: postgresProjectDiscovery(writerPool, metrics),
    decisions: postgresProjectDecision(writerPool, metrics),
    projects: postgresProjectStore(writerPool),
  };
}
