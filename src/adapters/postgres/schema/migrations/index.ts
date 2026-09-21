import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-worker-pool.ts";
import { migration003 } from "./003-no-handoff.ts";
import { migration004 } from "./004-no-accounts.ts";
import { migration005 } from "./005-three-deletions.ts";
import { migration006 } from "./006-rename.ts";
import { migration007 } from "./007-finalization-unavailable.ts";
import type { Migration } from "../shared.ts";

export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
];
