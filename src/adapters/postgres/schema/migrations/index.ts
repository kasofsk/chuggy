import { migration001 } from "./001-project-foundation.ts";
import { migration002 } from "./002-project-inbox.ts";
import { migration003 } from "./003-project-decision.ts";
import { migration004 } from "./004-tenure-fence.ts";
import { migration005 } from "./005-durable-prioritized-decision-mailbox.ts";
import { migration006 } from "./006-native-web-reads.ts";
import { migration007 } from "./007-native-versioned-authoring.ts";
import { migration008 } from "./008-bounded-project-notifications.ts";
import { migration009 } from "./009-selector-independent-dispatch.ts";
import { migration010 } from "./010-selector-controls.ts";
import { migration011 } from "./011-selector-attempts.ts";
import { migration012 } from "./012-durable-execution-scheduler.ts";
import { migration013 } from "./013-durable-finalizer.ts";
import { migration014 } from "./014-native-project-access.ts";
import { migration015 } from "./015-native-operational-reads.ts";
import { migration016 } from "./016-runtime-schema-readiness.ts";
import { migration017 } from "./017-selector-context-account-read.ts";
import { migration018 } from "./018-selector-review-readiness.ts";
import { migration019 } from "./019-execution-requirement-upgrade.ts";
import { migration020 } from "./020-repository-configuration-provenance.ts";
import { migration021 } from "./021-api-repository-binding-read.ts";
import { migration022 } from "./022-draft-initialization-fence.ts";
import { migration023 } from "./023-authoring-policy-and-dependencies.ts";
import { migration024 } from "./024-sole-completion-authority.ts";
import { migration025 } from "./025-installation-authority.ts";
import { migration026 } from "./026-handoff-recovery-outcomes.ts";
import { migration027 } from "./027-cross-repository-finalizer.ts";
import { migration028 } from "./028-worker-plane-authority.ts";
import { migration029 } from "./029-repository-configuration-binding-fence.ts";
import { migration030 } from "./030-api-dispatch-view-cursor-read.ts";
import { migration031 } from "./031-ticket-service-repository-binding-read.ts";
import { migration032 } from "./032-worker-source-handoff.ts";
import { migration033 } from "./033-continuation-readiness.ts";
import { migration034 } from "./034-worker-attempt-heartbeat.ts";
import { migration035 } from "./035-source-diagnostics.ts";
import { migration036 } from "./036-ticket-service-execution-source-read.ts";
import { migration037 } from "./037-evaluation-work-reports.ts";
import { migration038 } from "./038-durable-project-change-log.ts";
import { migration039 } from "./039-escalation-reason-projection.ts";
import { migration040 } from "./040-repository-activation.ts";
import { migration041 } from "./041-ticket-brief.ts";
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
];
