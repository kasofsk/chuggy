import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-worker-pool.ts";
import { migration003 } from "./003-no-handoff.ts";
import { migration004 } from "./004-no-accounts.ts";
import { migration005 } from "./005-three-deletions.ts";
import { migration006 } from "./006-rename.ts";
import { migration007 } from "./007-finalization-unavailable.ts";
import { migration008 } from "./008-escalation-sum.ts";
import { migration009 } from "./009-work-fanout.ts";
import { migration010 } from "./010-task-identity.ts";
import { migration011 } from "./011-evaluator-keys.ts";
import { migration012 } from "./012-task-report.ts";
import { migration013 } from "./013-released-ticket.ts";
import { migration014 } from "./014-ticket-events.ts";
import { migration015 } from "./015-ticket-commands.ts";
import { migration016 } from "./016-ticket-update.ts";
import type { Migration } from "../shared.ts";

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
];
