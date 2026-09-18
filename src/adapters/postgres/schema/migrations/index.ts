import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-ticket-machine.ts";
import { migration003 } from "./003-catalog-fragment.ts";
import { migration004 } from "./004-execution-capabilities.ts";
import { migration005 } from "./005-execution-queued-at.ts";
import type { Migration } from "../shared.ts";

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];
