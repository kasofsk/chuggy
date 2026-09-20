import { migration001 } from "./001-baseline.ts";
import { migration002 } from "./002-worker-pool.ts";
import type { Migration } from "../shared.ts";

export const migrations: readonly Migration[] = [migration001, migration002];
