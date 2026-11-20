/**
 * A project's connectors, one card each: its name, its kind, its settings and
 * the credential a configuration names it by, ready to copy. To a reader the
 * abilities read does not refuse `administer`, each also offers Change and
 * Remove, and Remove asks in place, naming what fails once it is gone.
 *
 * A removal is fenced on the revision the card was drawn from. One already
 * gone is read again and nothing is said; any other refusal is one line on
 * its card, and one the connector moved under has read the list again.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { ConnectorStandingResponse } from "../../../../../src/contract/connectorAdministration.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { connectorCredentialOf } from "../../../../../src/contract/workerEnvironment.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { apiRemoveConnector } from "../../core/apiRoutes.ts";
import {
  connectorKindLabel,
  connectorRemovalGone,
  connectorRemovalRefusal,
  connectorSettingsShown,
} from "../../core/connectors.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { copyOrDataText } from "../../core/copy.ts";
import type { CopyText } from "../../core/copy.ts";
import { connectorsReread } from "../../core/projectQueries.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { CopyBox } from "../ui/CopyBox.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Notice } from "../ui/Notice.tsx";
import { ConnectorWrite } from "./ConnectorWrite.tsx";

/** One connector removed, over once the list has answered again. */
function connectorRemovalWrite(
  partition: PartitionIdentity,
  text: CopyText,
): ConsoleWrite<ConnectorStandingResponse, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "connector-removal",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, connector, client) => {
      const answered = await apiRemoveConnector(
        ports,
        partition,
        connector.name,
        connector.revision,
      );
      if (answered.outcome === "Ok") return answered;
      await connectorsReread(client, partition);
      return connectorRemovalGone(answered)
        ? { outcome: "Ok", value: undefined }
        : answered;
    },
    refusal: (failure) => text(connectorRemovalRefusal(failure)),
    landed: (client) => connectorsReread(client, partition),
  };
}

interface ConnectorRemoving {
  /** The connector whose removal is asked and not yet sent or answered. */
  readonly asking: string | undefined;
  readonly busy: boolean;
  /** The line the last refused removal left, and the connector it was of. */
  readonly note: { readonly name: string; readonly words: string } | undefined;
  readonly press: (name: string) => void;
  readonly cancel: () => void;
  readonly send: (connector: ConnectorStandingResponse) => void;
}

function useConnectorRemoving(
  partition: PartitionIdentity,
  connectors: readonly ConnectorStandingResponse[],
): ConnectorRemoving {
  const text = useCopyText();
  const removing = useConsoleWrite(connectorRemovalWrite(partition, text), {
    drawn: (_, removed) =>
      connectors.some((connector) => connector.name === removed.name),
  });
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const refused = removing.error;
  const removed = removing.variables;
  return {
    asking,
    busy: removing.isPending,
    note:
      refused === null || removed === undefined
        ? undefined
        : { name: removed.name, words: refused.message },
    press: (name) => {
      removing.reset();
      setAsking(name);
    },
    cancel: () => {
      setAsking(undefined);
    },
    send: (connector) => {
      removing.mutate(connector, {
        onSettled: () => {
          setAsking(undefined);
        },
      });
    },
  };
}

function ConnectorSettings(props: {
  readonly connector: ConnectorStandingResponse;
}): ReactNode {
  const text = useCopyText();
  return (
    <Fields variant="inline">
      {connectorSettingsShown(props.connector).map((shown) => (
        <Field
          key={shown.setting}
          name={text(shown.label)}
          absent={shown.value === undefined}
        >
          <span className="break-all">
            {shown.value === undefined
              ? text({ id: "connectors-not-set" })
              : copyOrDataText(text, shown.value)}
          </span>
        </Field>
      ))}
    </Fields>
  );
}

/** Under a card: the line a refused removal left, and the Confirm a removal waits on. */
function ConnectorRemovalAsked(props: {
  readonly connector: ConnectorStandingResponse;
  readonly removing: ConnectorRemoving;
}): ReactNode {
  const text = useCopyText();
  const { connector, removing } = props;
  const words =
    removing.note?.name === connector.name ? removing.note.words : undefined;
  const asked = removing.asking === connector.name;
  if (words === undefined && !asked) return null;
  const named = { name: connector.name };
  return (
    <div className="grid gap-2">
      {words === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={words} />
      )}
      {asked ? (
        <Confirm
          question={text({ id: "connectors-remove-question", args: named })}
          confirm={text({ id: "connectors-remove" })}
          busy={removing.busy}
          onConfirm={() => {
            removing.send(connector);
          }}
          onCancel={removing.cancel}
        >
          {text({
            id: "connectors-remove-line",
            args: {
              ...named,
              credential: connectorCredentialOf(connector.name),
            },
          })}
        </Confirm>
      ) : null}
    </div>
  );
}

function ConnectorCard(props: {
  readonly partition: PartitionIdentity;
  readonly connector: ConnectorStandingResponse;
  /** The removal every card shares, where the reader may remove. */
  readonly removing: ConnectorRemoving | undefined;
}): ReactNode {
  const text = useCopyText();
  const { connector, removing } = props;
  const credential = connectorCredentialOf(connector.name);
  return (
    <li className="bg-surface-1 border-edge rounded-2 grid min-w-0 gap-3 border p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <h3 className="m-0 text-md font-medium break-all">
            {connector.name}
          </h3>
          <span className="text-sm text-ink-3">
            {text(connectorKindLabel(connector.kind))}
          </span>
        </div>
        {removing === undefined ? null : (
          <div className="flex items-center gap-2">
            <ConnectorWrite partition={props.partition} connector={connector} />
            <Button
              variant="quiet"
              size="sm"
              named={text({
                id: "connectors-remove-named",
                args: { name: connector.name },
              })}
              disabled={removing.busy || removing.asking !== undefined}
              onClick={() => {
                removing.press(connector.name);
              }}
            >
              {text({ id: "connectors-remove" })}
            </Button>
          </div>
        )}
      </div>
      <ConnectorSettings connector={connector} />
      <CopyBox
        about={text({ id: "connectors-credential-about" })}
        text={credential}
        copyLabel={text({ id: "connectors-copy", args: { credential } })}
      />
      {removing === undefined ? null : (
        <ConnectorRemovalAsked connector={connector} removing={removing} />
      )}
    </li>
  );
}

/** Drawn only where the project holds a connector. */
export function ConnectorsListing(props: {
  readonly partition: PartitionIdentity;
  readonly connectors: readonly ConnectorStandingResponse[];
  /** Whether the reader is offered Change and Remove. */
  readonly administer: boolean;
}): ReactNode {
  const text = useCopyText();
  const removing = useConnectorRemoving(props.partition, props.connectors);
  return (
    <ul
      aria-label={text({ id: "connectors-caption" })}
      className="m-0 grid min-w-0 list-none gap-3 p-0"
    >
      {props.connectors.map((connector) => (
        <ConnectorCard
          key={connector.name}
          partition={props.partition}
          connector={connector}
          removing={props.administer ? removing : undefined}
        />
      ))}
    </ul>
  );
}
