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
import { migration011 } from "./011-execution-capability-digest.ts";
import { migration012 } from "./012-execution-unreported-attempts.ts";
import { migration013 } from "./013-execution-workload-liveness.ts";
import { migration014 } from "./014-execution-run-measure.ts";
import { migration015 } from "./015-execution-run-evidence.ts";
import { migration016 } from "./016-scheduler-reads-machine-input.ts";
import { migration017 } from "./017-machine-appends-a-change.ts";
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
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
];
