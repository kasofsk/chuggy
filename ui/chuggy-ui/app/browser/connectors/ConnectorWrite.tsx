/**
 * Adding a connector, or changing one, in a dialog: a new one's name and kind,
 * then exactly that kind's settings, each fault beside the field it concerns.
 * A change names the revision it was read at and cannot move the name or the
 * kind, since another kind is another connector.
 *
 * A REFUSAL KEEPS WHAT WAS TYPED. One the connector moved under has read the
 * list again by the time it is drawn, and the draft takes the revision that
 * now stands, so the next Save is made against what the reader was told of.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { connectorKinds } from "../../../../../src/contract/connectors.ts";
import type { ConnectorStandingResponse } from "../../../../../src/contract/connectorAdministration.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { apiWriteConnector } from "../../core/apiRoutes.ts";
import {
  connectorDraftBlank,
  connectorDraftFaults,
  connectorDraftName,
  connectorDraftOf,
  connectorFaultsNone,
  connectorFieldsOf,
  connectorKindLabel,
  connectorWriteOf,
  connectorWriteRefusal,
  connectorWriteRefusedLine,
} from "../../core/connectors.ts";
import type {
  ConnectorDraft,
  ConnectorFaults,
  ConnectorFieldListed,
} from "../../core/connectors.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { CopyText } from "../../core/copy.ts";
import { connectorsReread } from "../../core/projectQueries.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { InvitationText } from "../settings/InvitationFields.tsx";
import { InviteFoot } from "../settings/InviteDialog.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Notice } from "../ui/Notice.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { Switch } from "../ui/Switch.tsx";

/** One draft sent; a refusal the connector moved under reads the list again before it lands. */
function connectorWrite(
  partition: PartitionIdentity,
  text: CopyText,
): ConsoleWrite<ConnectorDraft, ConnectorStandingResponse> {
  return {
    mutationKey: consoleWriteKey(
      "connector-write",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, draft, client) => {
      const request = connectorWriteOf(draft);
      if (request === undefined)
        throw new Error(text({ id: "connectors-refused-fields" }));
      const answered = await apiWriteConnector(
        ports,
        partition,
        connectorDraftName(draft),
        request,
      );
      if (
        answered.outcome !== "Ok" &&
        connectorWriteRefusal(answered, draft.kind).refusal === "Stale"
      )
        await connectorsReread(client, partition);
      return answered;
    },
    refusal: (failure) => text(connectorWriteRefusedLine(failure)),
    landed: (client) => connectorsReread(client, partition),
  };
}

interface ConnectorWriting {
  readonly draft: ConnectorDraft;
  readonly faults: ConnectorFaults;
  readonly busy: boolean;
  readonly note: string | undefined;
  readonly sendable: boolean;
  readonly change: (draft: ConnectorDraft) => void;
  readonly begin: (draft: ConnectorDraft) => void;
  readonly send: (done: () => void) => void;
}

/** The faults the contract finds in the draft, under those the last refusal named. */
function connectorFaultsJoined(
  typed: ConnectorFaults,
  refused: ConnectorFaults,
): ConnectorFaults {
  return {
    name: refused.name ?? typed.name,
    settings: { ...typed.settings, ...refused.settings },
    form: refused.form,
  };
}

function useConnectorWriting(
  partition: PartitionIdentity,
  open: boolean,
): ConnectorWriting {
  const text = useCopyText();
  const [draft, setDraft] = useState(connectorDraftBlank);
  const writing = useConsoleWrite(connectorWrite(partition, text), {
    drawn: open,
  });
  const failure = writing.error?.failure;
  const refusal =
    failure === undefined
      ? undefined
      : connectorWriteRefusal(failure, draft.kind);
  return {
    draft,
    faults: connectorFaultsJoined(
      connectorDraftFaults(draft),
      refusal?.refusal === "Faults" ? refusal.faults : connectorFaultsNone,
    ),
    busy: writing.isPending,
    note: writing.error?.message,
    sendable: connectorWriteOf(draft) !== undefined && !writing.isPending,
    change: (next) => {
      if (writing.error !== null) writing.reset();
      setDraft(next);
    },
    begin: (next) => {
      writing.reset();
      setDraft(next);
    },
    send: (done) => {
      const sent = draft;
      writing.mutate(sent, {
        onSuccess: done,
        onError: (refused) => {
          if (refused.failure === undefined || sent.revision === undefined)
            return;
          const stale = connectorWriteRefusal(refused.failure, sent.kind);
          if (stale.refusal === "Stale")
            setDraft({ ...sent, revision: stale.standing });
        },
      });
    },
  };
}

function ConnectorSettingField(props: {
  readonly listed: ConnectorFieldListed;
  readonly writing: ConnectorWriting;
}): ReactNode {
  const text = useCopyText();
  const { setting, field, required } = props.listed;
  const { draft, change } = props.writing;
  if (field.control === "Switch")
    return (
      <Switch
        label={text(field.label)}
        checked={draft.switches[setting] === true}
        about={
          <>
            <span>{text(field.about)}</span>
            <span>{text(field.cost)}</span>
          </>
        }
        onChange={(on) => {
          change({ ...draft, switches: { ...draft.switches, [setting]: on } });
        }}
      />
    );
  const label = text(field.label);
  const fault = props.writing.faults.settings[setting];
  return (
    <InvitationText
      label={
        required ? label : text({ id: "connectors-optional", args: { label } })
      }
      value={draft.texts[setting] ?? ""}
      fault={fault === undefined ? undefined : text(fault)}
      onChange={(value) => {
        change({ ...draft, texts: { ...draft.texts, [setting]: value } });
      }}
    />
  );
}

/** A new connector's name and kind, each chosen here and nowhere after. */
function ConnectorIdentityFields(props: {
  readonly writing: ConnectorWriting;
}): ReactNode {
  const text = useCopyText();
  const { draft, change, faults } = props.writing;
  const kind = text({ id: "connectors-kind" });
  return (
    <>
      <InvitationText
        label={text({ id: "connectors-name" })}
        value={draft.name}
        fault={faults.name === undefined ? undefined : text(faults.name)}
        onChange={(name) => {
          change({ ...draft, name });
        }}
      />
      <div className="grid gap-2">
        <span aria-hidden="true" className="text-sm font-medium text-ink-3">
          {kind}
        </span>
        <RadioGroup
          label={kind}
          value={draft.kind}
          options={connectorKinds.map((option) => ({
            value: option,
            text: text(connectorKindLabel(option)),
          }))}
          onChoose={(value) => {
            const chosen = connectorKinds.find((known) => known === value);
            if (chosen !== undefined) change({ ...draft, kind: chosen });
          }}
        />
      </div>
    </>
  );
}

/** A standing connector's name and kind, which a change cannot move. */
function ConnectorIdentityRead(props: {
  readonly draft: ConnectorDraft;
  readonly fault: string | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="grid gap-1">
      <Fields variant="inline">
        <Field name={text({ id: "connectors-name" })}>{props.draft.name}</Field>
        <Field name={text({ id: "connectors-kind" })}>
          {text(connectorKindLabel(props.draft.kind))}
        </Field>
      </Fields>
      {props.fault === undefined ? null : (
        <span className="text-xs text-tone-fail">{props.fault}</span>
      )}
    </div>
  );
}

function ConnectorFormFields(props: {
  readonly writing: ConnectorWriting;
  readonly adding: boolean;
}): ReactNode {
  const text = useCopyText();
  const { writing } = props;
  return (
    <div className="grid gap-4">
      {props.adding ? (
        <ConnectorIdentityFields writing={writing} />
      ) : (
        <ConnectorIdentityRead
          draft={writing.draft}
          fault={
            writing.faults.name === undefined
              ? undefined
              : text(writing.faults.name)
          }
        />
      )}
      {connectorFieldsOf(writing.draft.kind).map((listed) => (
        <ConnectorSettingField
          key={`${writing.draft.kind}/${listed.setting}`}
          listed={listed}
          writing={writing}
        />
      ))}
      {writing.faults.form === undefined ? null : (
        <Notice tone="danger" inline detail={text(writing.faults.form)} />
      )}
    </div>
  );
}

/** Add or Save, and Cancel. */
function ConnectorWriteFoot(props: {
  readonly writing: ConnectorWriting;
  readonly adding: boolean;
  readonly onSent: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { writing } = props;
  return (
    <InviteFoot
      made={false}
      busy={writing.busy}
      sendable={writing.sendable}
      words={
        props.adding
          ? {
              idle: { id: "connectors-add" },
              busy: { id: "connectors-adding" },
            }
          : {
              idle: { id: "connectors-save" },
              busy: { id: "connectors-saving" },
            }
      }
      onSend={() => {
        writing.send(props.onSent);
      }}
      onClose={props.onClose}
    />
  );
}

/** Add, or Change where `connector` names the one it changes. */
export function ConnectorWrite(props: {
  readonly partition: PartitionIdentity;
  readonly connector?: ConnectorStandingResponse;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  const writing = useConnectorWriting(props.partition, open);
  const connector = props.connector;
  const moved = (opened: boolean): void => {
    writing.begin(
      connector === undefined
        ? connectorDraftBlank
        : connectorDraftOf(connector),
    );
    setOpen(opened);
  };
  const title =
    connector === undefined
      ? text({ id: "connectors-add" })
      : text({
          id: "connectors-change-title",
          args: { name: connector.name },
        });
  return (
    <Dialog
      size="form"
      title={title}
      trigger={text(
        connector === undefined
          ? { id: "connectors-add" }
          : { id: "connectors-change" },
      )}
      {...(connector === undefined
        ? { triggerVariant: "primary" as const }
        : {
            triggerVariant: "quiet" as const,
            triggerNamed: text({
              id: "connectors-change-named",
              args: { name: connector.name },
            }),
          })}
      open={open}
      onOpenChange={moved}
      busy={writing.busy}
      note={writing.note}
      foot={
        <ConnectorWriteFoot
          writing={writing}
          adding={connector === undefined}
          onSent={() => {
            setOpen(false);
          }}
          onClose={() => {
            moved(false);
          }}
        />
      }
    >
      <ConnectorFormFields writing={writing} adding={connector === undefined} />
    </Dialog>
  );
}
