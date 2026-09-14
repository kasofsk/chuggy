import { migration001 } from "./001-baseline.ts";
import type { Migration } from "../shared.ts";

export const migrations: readonly Migration[] = [migration001];
