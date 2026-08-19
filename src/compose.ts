/**
 * The composition root: the only file that constructs an adapter, and the only
 * one nothing else may import.
 *
 * Both halves are enforced in `.dependency-cruiser.cjs` and neither is a style
 * preference. Constructing an adapter anywhere else would put a choice of
 * deployment inside a layer that must not have one; being imported by anything
 * would make this a module in the graph rather than its root, and the moment it
 * is in the graph the layers below can reach an adapter through it.
 *
 * It needs no exclusion from `no-orphan-module` and has none: an orphan there is
 * a module with no dependents AND no dependencies, and this one is all
 * dependencies. Nothing imports it, so what checks it is the compiler rather
 * than a suite — a stub that stopped satisfying its port fails to compile here,
 * which is the only claim this file makes.
 */

import { deskStub } from "./adapters/deskStub.ts";
import { fabricStub } from "./adapters/fabricStub.ts";
import { finalizerStub } from "./adapters/finalizerStub.ts";
import { journalStoreStub } from "./adapters/journalStoreStub.ts";
import type { Config } from "./domain/config.ts";
import type { Executor } from "./interpreter/executor.ts";

/** Wires the executor against the stub adapters, which is every deployment choice this tree has yet made. */
export function compose(config: Config): Executor {
  return {
    config,
    store: journalStoreStub(),
    ports: {
      fabric: fabricStub(),
      finalizer: finalizerStub(),
      desk: deskStub(),
    },
  };
}
