/**
 * A project's connectors, with Add to a reader the abilities read does not
 * refuse `administer`, and under them every change made to one, newest first,
 * a page at a time as the reader asks for the next.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { connectorChangeLine } from "../../core/connectors.ts";
import { instantFigure } from "../../core/figures.ts";
import { creatorLabel } from "../../core/labels.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  connectorHistoryQuery,
  connectorsQuery,
} from "../../core/projectQueries.ts";
import { usePanelState } from "../api.ts";
import { useCreatorNames } from "../creatorNames.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { ScreenTitle } from "../shell/slots.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Table } from "../ui/Table.tsx";
import { ConnectorsListing } from "./ConnectorsListing.tsx";
import { ConnectorWrite } from "./ConnectorWrite.tsx";

function ConnectorsRead(props: {
  readonly partition: PartitionIdentity;
  readonly administer: boolean;
}): ReactNode {
  const text = useCopyText();
  const read = usePanelState(connectorsQuery(props.partition));
  if (read.state !== "Ready") return <PanelUnready state={read} />;
  if (read.value.connectors.length === 0)
    return (
      <div className="grid justify-items-start gap-3">
        <EmptyState label={text({ id: "connectors-none" })} />
        <Notice
          tone="info"
          inline
          detail={text({ id: "connectors-none-about" })}
        />
      </div>
    );
  return (
    <ConnectorsListing
      partition={props.partition}
      connectors={read.value.connectors}
      administer={props.administer}
    />
  );
}

/** One page of changes, and under it the next once the reader has asked for it. */
function ConnectorHistoryPage(props: {
  readonly partition: PartitionIdentity;
  readonly before: number | undefined;
  readonly names: ReadonlyMap<string, string>;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const read = usePanelState(
    connectorHistoryQuery(props.partition, props.before),
  );
  const [older, setOlder] = useState(false);
  if (read.state !== "Ready")
    return (
      <tbody>
        <tr>
          <td colSpan={3}>
            <PanelUnready state={read} />
          </td>
        </tr>
      </tbody>
    );
  const next = read.value.next;
  return (
    <>
      <tbody>
        {read.value.changes.map((change) => (
          <tr key={change.change}>
            <th scope="row" className="break-all">
              {text(connectorChangeLine(change))}
            </th>
            <td>
              <Identity
                label={creatorLabel(change.author.subject, props.names)}
              />
            </td>
            <td>
              <Figure figure={instantFigure(change.changedAt, props.nowMs)} />
            </td>
          </tr>
        ))}
        {next === undefined || older ? null : (
          <tr>
            <td colSpan={3}>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  setOlder(true);
                }}
              >
                {text({ id: "connectors-history-older" })}
              </Button>
            </td>
          </tr>
        )}
      </tbody>
      {next === undefined || !older ? null : (
        <ConnectorHistoryPage {...props} before={next} />
      )}
    </>
  );
}

function ConnectorHistory(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const names = useCreatorNames(props.partition);
  const nowMs = useNowMs();
  const first = usePanelState(connectorHistoryQuery(props.partition));
  if (first.state !== "Ready") return <PanelUnready state={first} />;
  if (first.value.changes.length === 0)
    return <EmptyState label={text({ id: "connectors-history-none" })} />;
  return (
    <Table caption={text({ id: "connectors-history-caption" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "connectors-history-what" })}</th>
          <th scope="col">{text({ id: "connectors-history-who" })}</th>
          <th scope="col">{text({ id: "connectors-history-when" })}</th>
        </tr>
      </thead>
      <ConnectorHistoryPage
        partition={props.partition}
        before={undefined}
        names={names}
        nowMs={nowMs}
      />
    </Table>
  );
}

export function ConnectorsPage(): ReactNode {
  const text = useCopyText();
  const params = useParams({ from: settingsRoutes.project.connectors });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const administer = !projectAbilityRefused(
    useProjectAbilities(partition),
    "administer",
  );
  const title = text({ id: "connectors-title" });
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <ScreenTitle>{title}</ScreenTitle>
      <Panel
        variant="section"
        title={title}
        about={text({ id: "connectors-about" })}
        meta={administer ? <ConnectorWrite partition={partition} /> : undefined}
      >
        <ConnectorsRead partition={partition} administer={administer} />
      </Panel>
      <Panel
        variant="section"
        title={text({ id: "connectors-history" })}
        about={text({ id: "connectors-history-about" })}
      >
        <ConnectorHistory partition={partition} />
      </Panel>
    </div>
  );
}
