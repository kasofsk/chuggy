import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-ticket-machine.ts";
import type { Migration } from "../shared.ts";

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [migration001, migration002];
