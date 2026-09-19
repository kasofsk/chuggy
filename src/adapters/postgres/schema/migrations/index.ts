import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-ticket-machine.ts";
import { migration003 } from "./003-catalog-fragment.ts";
import { migration004 } from "./004-execution-capabilities.ts";
import { migration005 } from "./005-execution-queued-at.ts";
import { migration006 } from "./006-execution-worker-view.ts";
import { migration007 } from "./007-execution-pool-assignment.ts";
import { migration008 } from "./008-worker-pool.ts";
import { migration009 } from "./009-worker-pool-principal.ts";
import { migration010 } from "./010-worker-pool-registration-token.ts";
import type { Migration } from "../shared.ts";

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
];
