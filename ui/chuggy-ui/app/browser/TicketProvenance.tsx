/**
 * Where this ticket came from: the brief's images, and what the live revision
 * runs with, one row per step of the configuration it pinned with its
 * overrides applied.
 *
 * A configuration is named where the wire names it and drawn as its revision
 * where it is not.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { BriefFinalizationOf } from "../../../../src/contract/brief.ts";
import type {
  ConfigurationResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { configurationQuery } from "../core/configurationQueries.ts";
import { finalizationLine, gitMergePolicyLabel } from "../core/codeLabels.ts";
import { ticketFollowingSentence } from "../core/codeSentences.ts";
import {
  configurationFollowingWord,
  configurationStepsOf,
} from "../core/configurationSteps.ts";
import { configurationLabel, digestShortened } from "../core/labels.ts";
import type { Label } from "../core/labels.ts";
import { navRoutes } from "../core/shellNav.ts";
import { usePanelState } from "./api.ts";
import { ConfigurationStepsTable } from "./ConfigurationSteps.tsx";
import { PanelUnready } from "./DataPanel.tsx";
import { Chip } from "./ui/Chip.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { ProjectImage } from "./ProjectImage.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { useCopyText } from "../copy/CopyProvider.tsx";

import "./ticket/ticket.css";

/**
 * The images a person attached to the brief, each drawn from the project's own
 * read of it. The brief's other fields are the sidebar's and the
 * instructions' to draw.
 */
export function TicketBriefImages(props: {
  readonly partition: PartitionIdentity;
  readonly brief: TicketResponse["brief"];
}): ReactNode {
  const images = props.brief?.images;
  const text = useCopyText();
  if (images === undefined || images.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {images.map((artifact, at) => (
        <li key={artifact}>
          <ProjectImage
            partition={props.partition}
            artifact={artifact}
            alt={text({
              id: "ticket-provenance-brief-image-alt",
              args: { number: at + 1 },
            })}
            className="rounded-2 border-edge block max-h-(--height-clip) max-w-full border"
            opens
          />
        </li>
      ))}
    </ul>
  );
}

/** One cell of a summary grid: a small key above a value, and an optional
 * dim line under it for what the value alone does not say. */
export function SummaryCell(props: {
  readonly name: string;
  readonly value: ReactNode;
  readonly meta?: ReactNode;
  readonly large?: boolean;
  readonly overridden?: boolean;
}): ReactNode {
  return (
    <div className="ticket-config-cell">
      <span className="eyebrow">
        {props.name}
        {props.overridden === true ? <OverriddenMark /> : null}
      </span>
      <span
        className={
          props.large === true
            ? "ticket-config-value-lg"
            : "ticket-config-value"
        }
      >
        {props.value}
      </span>
      {props.meta === undefined ? null : (
        <span className="ticket-config-meta">{props.meta}</span>
      )}
    </div>
  );
}

/** What a field the ticket overrode carries beside its name. */
function OverriddenMark(): ReactNode {
  const text = useCopyText();
  return (
    <>
      {" "}
      <span className="ticket-config-chip">
        {text({ id: "ticket-provenance-overridden" })}
      </span>
    </>
  );
}

export function ConfigurationChips(props: {
  readonly items: readonly string[];
}): ReactNode {
  return (
    <div className="ticket-config-chips">
      {props.items.map((item) => (
        <span key={item} className="ticket-config-chip">
          {item}
        </span>
      ))}
    </div>
  );
}

/** The finalization a ticket's brief or its finalizer names. */
type ConfigurationFinalization = BriefFinalizationOf<string | undefined>;

/** The finalization a ticket takes, as the one line its brief or its
 * finalizer says it, and the policy a git merge is ordered under. */
export function FinalizationMethod(props: {
  readonly finalization: ConfigurationFinalization;
}): ReactNode {
  const finalization = props.finalization;
  const text = useCopyText();
  return (
    <>
      <SummaryCell
        name={text({ id: "ticket-provenance-method" })}
        value={text(finalizationLine(finalization))}
      />
      {finalization.kind === "GitMerge" ? (
        <SummaryCell
          name={text({ id: "ticket-provenance-policy" })}
          value={text(gitMergePolicyLabel(finalization.policy))}
        />
      ) : null}
    </>
  );
}

/** The name and version chip a repository import carries, or the bare
 * revision an authored one has no label for. */
export function ConfigurationHeaderLabel(props: {
  readonly revision: string;
  readonly version: TicketResponse["configurationVersion"];
}): ReactNode {
  const label = configurationLabel(props.revision, props.version);
  return props.version === undefined ? (
    <code className="ticket-config-name">{label.text}</code>
  ) : (
    <>
      <code className="ticket-config-name">{props.version.name}</code>{" "}
      <span className="ticket-config-chip">{`#${String(props.version.number)}`}</span>
    </>
  );
}

/** The digest this document hashes to and the revision it is filed under. */
function ConfigurationFoot(props: {
  readonly revision: string;
  readonly digest: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <p className="config-foot">
      <span>{text({ id: "ticket-provenance-digest" })}</span>{" "}
      <Tooltip text={props.digest}>
        <code>{digestShortened(props.digest)}</code>
      </Tooltip>
      <span> · </span>
      <code>{props.revision}</code>
    </p>
  );
}

/** The pinned document whole, opened in place. */
function ConfigurationCanonical(props: {
  readonly canonical: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const text = useCopyText();
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      label={text({ id: "ticket-provenance-canonical-json" })}
      look={{ variant: "quiet", size: "sm" }}
    >
      <pre className="ticket-config-canonical">{props.canonical}</pre>
    </Disclosure>
  );
}

/** What a ticket's heading names beside the configuration: its name, and
 * its place in the Catalog. */
interface ConfigurationNamed {
  readonly name: Label;
  readonly catalog: ReactNode;
}

/** A configuration as a ticket runs it, or as it stands where nothing
 * overrides or selects from it, under a heading naming it where it is a
 * ticket's. */
export function ConfigurationBody(props: {
  readonly configuration: ConfigurationResponse;
  readonly overrides: TicketResponse["overrides"];
  readonly selection: TicketResponse["selection"];
  /** The finalization the ticket's brief names. */
  readonly finalization?: ConfigurationFinalization | undefined;
  readonly named?: ConfigurationNamed;
  readonly children?: ReactNode;
}): ReactNode {
  const { configuration, named } = props;
  const text = useCopyText();
  const steps = configurationStepsOf({
    canonical: configuration.canonical,
    overrides: props.overrides,
    selection: props.selection,
    finalization: props.finalization,
  });
  return (
    <div className="ticket-config">
      <div className="config-heading">
        <span className="config-heading-title">
          {named === undefined ? null : (
            <>
              <h2 className="config-heading-name" title={named.name.title}>
                {named.name.text}
              </h2>
              <Chip>{text(configurationFollowingWord(steps.following))}</Chip>
            </>
          )}
        </span>
        {named?.catalog}
        <ConfigurationCanonical canonical={configuration.canonical} />
      </div>
      {props.children}
      <ConfigurationStepsTable steps={steps} />
      <ConfigurationFoot
        revision={configuration.revision}
        digest={configuration.digest}
      />
    </div>
  );
}

/** The configuration's own place in the Catalog. */
function ConfigurationCatalogLink(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <Link
      to={navRoutes.catalog}
      params={props.partition}
      search={{ configuration: props.revision }}
      className="config-heading-link"
    >
      {text({ id: "ticket-provenance-catalog-link" })}
      <span aria-hidden="true"> ↗</span>
    </Link>
  );
}

/** What a configuration is drawn from: a released ticket's own read, or a
 * draft as it stands, which follows nothing. */
export type TicketConfigured = Pick<
  TicketResponse,
  | "configurationRevision"
  | "configurationVersion"
  | "overrides"
  | "selection"
  | "following"
  | "brief"
>;

/** The configuration the live revision pins, read by its own revision so a
 * tab that never reads the ticket still reads the right one. */
function ConfigurationDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
  readonly ticket: TicketConfigured;
}): ReactNode {
  const { ticket } = props;
  const text = useCopyText();
  const stays = ticketFollowingSentence(ticket.following);
  const state = usePanelState(
    configurationQuery(props.partition, props.revision, "Streamed"),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <ConfigurationBody
      configuration={state.value}
      overrides={ticket.overrides}
      selection={ticket.selection}
      finalization={ticket.brief?.finalization}
      named={{
        name: configurationLabel(props.revision, ticket.configurationVersion),
        catalog: (
          <ConfigurationCatalogLink
            partition={props.partition}
            revision={props.revision}
          />
        ),
      }}
    >
      {stays === undefined ? null : (
        <p className="ticket-config-following">{text(stays)}</p>
      )}
    </ConfigurationBody>
  );
}

/** The configuration the live revision pins, drawn once the ticket is read. */
export function TicketConfiguration(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketConfigured | undefined;
}): ReactNode {
  const ticket = props.ticket;
  if (ticket?.configurationRevision === undefined) return null;
  return (
    <ConfigurationDrawn
      partition={props.partition}
      revision={ticket.configurationRevision}
      ticket={ticket}
    />
  );
}
