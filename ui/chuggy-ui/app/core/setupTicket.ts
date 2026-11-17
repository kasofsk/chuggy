/**
 * `ticket`: the project's first ticket filed from the person's own words, or
 * else as the end-to-end check setup announces, as the console's Create
 * ticket files one.
 *
 * Under a bootstrap, what the ticket asks for also carries the worker image
 * setup recommended and the toolchains it was recommended for, which the
 * bootstrap's brief lets the repository's configuration name, and asks for
 * the `AGENTS.md` of `setupTicketAgentsPath` saying only what that folder
 * is. A bootstrap ticket is not filed without the image, since its worker
 * could not run the checks it commands on an image nobody chose.
 *
 * What it may be drawn under is read as the creation screen reads it, the form
 * is the one that screen starts on, with the title and what is wanted done
 * typed into it and the branch it proposes, and it is created, released and
 * dispatched by the same core. Where the project offers one configuration it
 * is that one; where it offers several, the person's choice of them, which is
 * never guessed. The writes its ports let out are the draft's creation and
 * the submissions of its release and its dispatch; whether the step is done is
 * the checklist's to say, read after.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import { repositoryDeclarationRoot } from "../../../../src/contract/repositoryDeclaration.ts";
import { chuggyDocsIndex } from "../../../../src/contract/sessionTools.ts";

import type { ApiPorts } from "./apiRequest.ts";
import type { Copy, CopyText } from "./copy.ts";
import type { SetupTicketSaid, SetupTicketWorker } from "./setupArguments.ts";
import type { SetupTicketAnswered } from "./setupReport.ts";
import {
  creationBodyFrom,
  creationBootstrapLine,
  creationConfigurationStart,
  creationFormFrom,
  creationFormProposed,
  creationOfferOf,
} from "./ticketCreation.ts";
import type { CreationOffer } from "./ticketCreation.ts";
import {
  createAndReleaseTicket,
  creationContextSentence,
  readCreationContext,
} from "./ticketCreationRun.ts";
import type { CreationContext } from "./ticketCreationRun.ts";

/** The file the first ticket under a bootstrap asks for, saying what the folder chuggy reads a repository's declarations from is. */
export const setupTicketAgentsPath = `${repositoryDeclarationRoot}AGENTS.md`;

/** How often `watch` reads the checklist again while the first ticket is on its way to its landing. */
export const setupWatchPollMs = 5_000;

/** The writes `ticket` makes for a project: the draft's creation, and the submissions of its release and its dispatch. */
export function setupTicketWrites(
  partition: PartitionIdentity,
): readonly string[] {
  const at = (route: string): string =>
    route
      .replace(":tenant", encodeURIComponent(partition.tenant))
      .replace(":project", encodeURIComponent(partition.project));
  return [
    `POST ${at(nativeHttpRoutes.drafts)}`,
    `POST ${at(nativeHttpRoutes.operations)}`,
  ];
}

/**
 * What the ticket step's question offers: the names of the configurations a
 * ticket may be drawn under, and whether the person must choose among them,
 * which they must wherever there is more than one or the read may have missed
 * some. None where the project offers nothing the creation screen could draw.
 */
export interface SetupTicketOffers {
  readonly names: readonly string[];
  readonly choose: boolean;
  /** Whether the one offer the ticket is drawn under, with nothing to choose, is a bootstrap, so the ticket also writes the repository's own configuration. */
  readonly bootstrap: boolean;
  /** Whether some offer is a bootstrap, so the ticket, drawn under that one, is not filed without the worker image chosen. */
  readonly bootstrapOffered: boolean;
}

/** The offers of a context read, as the ticket step's question puts them. */
export function setupTicketOffersOf(
  context: CreationContext,
): SetupTicketOffers | undefined {
  if (context.context !== "Ready" || context.offers.length === 0)
    return undefined;
  const start = creationOfferOf(
    context.offers,
    creationConfigurationStart(context.offers, undefined, context.partial),
  );
  return {
    names: context.offers.map((offer) => offer.name),
    choose: start === undefined,
    bootstrap:
      start !== undefined && creationBootstrapLine(start) !== undefined,
    bootstrapOffered: context.offers.some(
      (offer) => creationBootstrapLine(offer) !== undefined,
    ),
  };
}

/** What the ticket step's question offers, read through `ports`; none where the read failed or offers nothing. */
export async function setupTicketOffersRead(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<SetupTicketOffers | undefined> {
  const read = await readCreationContext(ports, partition);
  return read.outcome === "Ok" ? setupTicketOffersOf(read.value) : undefined;
}

/** What the person said of the ticket where they asked for something of their own, the worker image chosen and its toolchains where they were given, and the configuration they chose where they named one. */
export interface SetupTicketBrief {
  readonly said: SetupTicketSaid | undefined;
  readonly worker: SetupTicketWorker | undefined;
  readonly configuration: string | undefined;
}

/** What the ticket is filed as, or the refusal of a bootstrap ticket no image was chosen for: the person's words or the end-to-end check, and under a bootstrap the `setupTicketAgentsPath` file and the image after them. */
export function setupTicketWritten(
  brief: Pick<SetupTicketBrief, "said" | "worker">,
  bootstrap: boolean,
  text: CopyText,
): SetupTicketSaid | SetupTicketAnswered {
  const said = brief.said ?? {
    title: text({ id: "setup-ticket-check-title" }),
    intent: text({ id: "setup-ticket-check-intent" }),
  };
  if (!bootstrap) return said;
  if (brief.worker === undefined)
    return setupTicketRefused({ id: "setup-ticket-imageless" });
  const paragraphs = [
    said.intent,
    text({
      id: "setup-ticket-agents",
      args: { agents: setupTicketAgentsPath, docs: chuggyDocsIndex },
    }),
    text({ id: "setup-ticket-image", args: { ...brief.worker } }),
  ];
  return { title: said.title, intent: paragraphs.join("\n\n") };
}

function setupTicketRefused(refusal: Copy): SetupTicketAnswered {
  return { answered: "Refused", refusal };
}

/** The offer the ticket is drawn under: the one named, or the one there is where nothing is to choose; a refusal naming every offer otherwise. */
function setupTicketOffer(
  offers: readonly CreationOffer[],
  partial: boolean,
  named: string | undefined,
): CreationOffer | SetupTicketAnswered {
  const name = named ?? creationConfigurationStart(offers, undefined, partial);
  const offer = creationOfferOf(offers, name);
  if (offer !== undefined) return offer;
  return setupTicketRefused({
    id: named === undefined ? "setup-ticket-choose" : "setup-ticket-unoffered",
    args: { names: offers.map((one) => one.name).join(", ") },
  });
}

/** A ticket filed under `offer`: the name it is offered under, and whether it is a bootstrap, whose ticket also writes the repository's own configuration. */
export function setupTicketFiledUnder(
  ticket: number,
  offer: CreationOffer,
): SetupTicketAnswered {
  return {
    answered: "Filed",
    ticket,
    configuration: offer.name,
    bootstrap: creationBootstrapLine(offer) !== undefined,
  };
}

/**
 * Files the ticket through `ports`, which let out only the writes
 * `setupTicketWrites` names: the creation context read, the form drawn under
 * the offer chosen and filled with `brief`, and the body it assembles created,
 * released and dispatched under the operations given, in the words `text`
 * says a refusal of the console's creation in.
 */
export async function setupTicketFiled(
  ports: ApiPorts,
  partition: PartitionIdentity,
  brief: SetupTicketBrief,
  operations: { readonly release: string; readonly dispatch: string },
  text: CopyText,
): Promise<SetupTicketAnswered> {
  const read = await readCreationContext(ports, partition);
  if (read.outcome !== "Ok")
    return setupTicketRefused({ id: "setup-ticket-unread" });
  const context = read.value;
  if (context.context !== "Ready")
    return setupTicketRefused(creationContextSentence(context));
  const { offers, partial, repositories } = context;
  const offer = setupTicketOffer(offers, partial, brief.configuration);
  if ("answered" in offer) return offer;
  const written = setupTicketWritten(
    brief,
    creationBootstrapLine(offer) !== undefined,
    text,
  );
  if ("answered" in written) return written;
  const form = creationFormProposed({
    ...creationFormFrom(offers, repositories, offer.name, partial),
    ...written,
  });
  const assembled = creationBodyFrom(offers, form, repositories);
  if (assembled.assembled === "Faults")
    return setupTicketRefused({
      id: "setup-ticket-faults",
      args: {
        faults: assembled.faults.map((fault) => text(fault.reason)).join("; "),
      },
    });
  const created = await createAndReleaseTicket(
    ports,
    partition,
    {
      body: assembled.body,
      operation: operations.release,
      dispatchOperation: operations.dispatch,
    },
    () => undefined,
    text,
  );
  return created.created === "Created" || created.created === "Exists"
    ? setupTicketFiledUnder(created.ticket, offer)
    : setupTicketRefused({
        id: "setup-ticket-refused",
        args: { refusal: created.reason },
      });
}
