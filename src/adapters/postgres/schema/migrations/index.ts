import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-worker-pool.ts";
import { migration003 } from "./003-no-handoff.ts";
import { migration004 } from "./004-no-accounts.ts";
import type { Migration } from "../shared.ts";

export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
];
