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
import { migration017 } from "./017-ticket-repin.ts";
import { migration018 } from "./018-attempt-invocation.ts";
import { migration019 } from "./019-session-invocation.ts";
import { migration020 } from "./020-worker-pool-class.ts";
import { migration021 } from "./021-scheduler-reads-pools.ts";
import { migration022 } from "./022-worker-pool-fencing.ts";
import { migration023 } from "./023-worker-pool-release-ends.ts";
import { migration024 } from "./024-scheduler-writes-placement.ts";
import { migration025 } from "./025-pool-harness-heartbeat.ts";
import { migration026 } from "./026-project-creation.ts";
import { migration027 } from "./027-forge-claim-per-tenant.ts";
import { migration028 } from "./028-binding-lands-by-pull-request.ts";
import { migration029 } from "./029-project-execution-placement.ts";
import { migration030 } from "./030-api-reads-worker-error.ts";
import { migration031 } from "./031-session-bearer-turn-failure.ts";
import { migration032 } from "./032-session-placement.ts";
import { migration033 } from "./033-pool-sessions.ts";
import { migration034 } from "./034-held-proposal-currency.ts";
import { migration035 } from "./035-thread-turn-stop.ts";
import { migration036 } from "./036-repository-actions.ts";
import { migration037 } from "./037-action-observations.ts";
import { migration038 } from "./038-action-reach.ts";
import { migration039 } from "./039-brief-images.ts";
import { migration040 } from "./040-configuration-overrides.ts";
import { migration041 } from "./041-session-closed-evidence.ts";
import { migration042 } from "./042-lead-succession.ts";
import { migration043 } from "./043-parked-overrides.ts";
import { migration044 } from "./044-ticket-landings.ts";
import { migration045 } from "./045-selector-attempt-revision.ts";
import { migration046 } from "./046-invite-links.ts";
import { migration047 } from "./047-workspace-links.ts";
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
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
  migration041,
  migration042,
  migration043,
  migration044,
  migration045,
  migration046,
  migration047,
];
