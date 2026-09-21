/**
 * The `Config` the corpus was emitted from, keyed by the string the manifest's
 * `instance` column carries.
 *
 * It is transcribed whole from its module header in `model/mc/mc_chuggy.qnt`
 * rather than derived, so a reader checks it against the model by reading down
 * it. `model/mc/mc_chuggy_directed.qnt` declares a parallel module with those
 * same constants under a different name — the same machine under a restricted
 * step relation, which changes which steps the sampler may try and nothing
 * about what a step does — so a directed golden's manifest row names its
 * undirected sibling and replays here.
 */

import type { Config } from "../../src/domain/config.ts";

/** The instance every golden is emitted from and every suite below runs at. */
export const modelInstance: Config = {
  nTickets: 3,
  nTasks: 2,
  maxStages: 2,
};

/** Every instance the corpus draws from, under the name its manifest row carries. */
export const CONFIGS: Readonly<Record<string, Config>> = {
  mc_chuggy: modelInstance,
};
