/**
 * Whether an escalated ticket may take the overrides offered for it: the
 * effective configuration is ready, and the definition it resolves is the one
 * the overrides it holds resolve.
 *
 * THE FOLD DECIDES, NOT A LIST. Both definitions are resolved by the code that
 * is running, from the same pinned document, authoring and brief, so the one
 * thing that differs between them is the overrides. The digest a release
 * stored is not consulted: the material folds values this image holds, and a
 * digest stored under an image that held others would refuse every change.
 */

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import {
  draftReleaseReadiness,
  type CanonicalConfiguration,
  type ReleaseAuthoring,
} from "./authoring.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { DraftBrief } from "./ticketBrief.ts";
import {
  materialDigest,
  ticketDefinitionMaterial,
} from "./ticketDefinition.ts";

/** What one escalated ticket is resolved from, less the overrides. */
export interface ParkedTicketResolution {
  readonly configuration: CanonicalConfiguration;
  readonly configurationRepository: RepositoryId | undefined;
  readonly authoring: ReleaseAuthoring;
  readonly brief: DraftBrief | undefined;
}

export type ParkedOverridesVerdict =
  | { readonly verdict: "Admitted" }
  | {
      readonly verdict: "Refused";
      readonly code: "ConfigurationInvalid" | "OverridesMoveDefinition";
    };

/** The digest of the definition one set of overrides resolves, or none where the configuration it makes is not ready. */
function parkedOverridesDefinitionDigest(
  ticket: ParkedTicketResolution,
  overrides: ConfigurationOverrides | undefined,
): string | undefined {
  const readiness = draftReleaseReadiness(
    ticket.configuration,
    ticket.brief,
    ticket.configurationRepository,
    overrides,
  );
  if (readiness.readiness === "Incomplete") return undefined;
  return materialDigest(
    ticketDefinitionMaterial({
      authoring: ticket.authoring,
      configuration: readiness.configuration,
      ...(ticket.brief === undefined ? {} : { brief: ticket.brief }),
    }),
  );
}

/**
 * Judges the offered overrides as a release judges a draft's, then holds the
 * definition they resolve to the one the held overrides resolve. Held
 * overrides the running code cannot resolve give nothing to hold the offer
 * to, and the offer is refused as one that moves the definition.
 */
export function parkedOverridesVerdict(
  ticket: ParkedTicketResolution,
  held: ConfigurationOverrides | undefined,
  offered: ConfigurationOverrides,
): ParkedOverridesVerdict {
  const moved = parkedOverridesDefinitionDigest(ticket, offered);
  if (moved === undefined)
    return { verdict: "Refused", code: "ConfigurationInvalid" };
  return moved === parkedOverridesDefinitionDigest(ticket, held)
    ? { verdict: "Admitted" }
    : { verdict: "Refused", code: "OverridesMoveDefinition" };
}
