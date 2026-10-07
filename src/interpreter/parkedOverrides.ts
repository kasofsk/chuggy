/**
 * Whether a parked ticket may hold other overrides than it holds.
 *
 * THE FOLD DECIDES, NOT A LIST. The definition is resolved twice from the
 * ticket's own pin, brief and authoring with the code that is running — once
 * under the overrides held and once under the ones offered — and the change is
 * admitted where the two are equal. A field the fold does not read cannot move
 * it, so what is admitted is exactly what is read only when an attempt is
 * prepared.
 *
 * THE STORED DIGEST IS NOT THE OTHER SIDE. The material folds values the code
 * holds, so a ticket released before one of them moved would compare unequal
 * to itself and take no change at all.
 */

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import { draftReleaseReadiness, type ReleaseAuthoring } from "./authoring.ts";
import type { CanonicalConfiguration } from "./canonicalConfiguration.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { DraftBrief } from "./ticketBrief.ts";
import {
  materialDigest,
  ticketDefinitionMaterial,
} from "./ticketDefinition.ts";

/** What a change of a parked ticket's overrides is answered: admitted, or the refusal it earns. */
export type ParkedOverridesVerdict =
  "Admitted" | "ConfigurationInvalid" | "DefinitionLocked";

/** What a parked ticket was released under, which no change of its overrides moves. */
export interface ParkedTicketRelease {
  readonly configuration: CanonicalConfiguration;
  readonly configurationRepository: RepositoryId | undefined;
  readonly brief: DraftBrief | undefined;
  readonly authoring: ReleaseAuthoring;
}

/** The digest of the definition one set of overrides resolves, absent where it resolves none. */
function parkedOverridesDefinition(
  release: ParkedTicketRelease,
  overrides: ConfigurationOverrides | undefined,
): string | undefined {
  const readiness = draftReleaseReadiness(
    release.configuration,
    release.brief,
    release.configurationRepository,
    overrides,
  );
  if (readiness.readiness !== "Ready") return undefined;
  return materialDigest(
    ticketDefinitionMaterial({
      authoring: release.authoring,
      configuration: readiness.configuration,
      ...(release.brief === undefined ? {} : { brief: release.brief }),
    }),
  );
}

/**
 * The verdict on offering `offered` in place of `held`. A configuration not
 * ready under the offer is refused as a release would refuse it, and a held set
 * the running code no longer resolves cannot be shown to equal anything.
 */
export function parkedOverridesVerdict(
  release: ParkedTicketRelease,
  held: ConfigurationOverrides | undefined,
  offered: ConfigurationOverrides | undefined,
): ParkedOverridesVerdict {
  const changed = parkedOverridesDefinition(release, offered);
  if (changed === undefined) return "ConfigurationInvalid";
  return parkedOverridesDefinition(release, held) === changed
    ? "Admitted"
    : "DefinitionLocked";
}
