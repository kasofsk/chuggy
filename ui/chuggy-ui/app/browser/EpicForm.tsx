/**
 * The form an epic is revised through: its content as typed, the
 * faults it has before it is sent, and the refusal the API answered.
 *
 * A revision is sent with the revision it was read at, so one made over
 * another's is refused as stale and the form offers to read the epic again
 * rather than send it a second time. What is typed stands on that revision
 * until the form saves it or the reader asks for the epic again: a read of a
 * later one in between leaves it as typed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import type { Copy } from "../core/copy.ts";
import {
  epicFormFaults,
  epicWrite,
  epicWriteFrom,
  epicsInvalidated,
} from "../core/epics.ts";
import type { EpicForm } from "../core/epics.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "./consoleWrite.tsx";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

/** The epic a form revises, at the revision it was read at. */
export interface EpicHeld {
  readonly epic: number;
  readonly revision: number;
  readonly form: EpicForm;
}

function EpicFormFaults(props: {
  readonly faults: readonly Copy[];
}): ReactNode {
  const text = useCopyText();
  if (props.faults.length === 0) return null;
  return (
    <ul
      className="grid gap-1 text-sm"
      aria-label={text({ id: "epics-faults-label" })}
    >
      {props.faults.map((fault) => (
        <li key={fault.id}>
          <Notice tone="danger" inline detail={text(fault)} />
        </li>
      ))}
    </ul>
  );
}

/** A revision a sibling's write has overtaken, which only reading the epic again can mend. */
function stale(code: string | undefined): boolean {
  return code === "StaleRevision";
}

/** The press that reads the epic again once a sibling's write overtook it. */
function EpicFormReload(props: { readonly onReload: () => void }): ReactNode {
  const text = useCopyText();
  return (
    <Button variant="quiet" onClick={props.onReload}>
      {text({ id: "epics-reload" })}
    </Button>
  );
}

/** Submit; Cancel, where the form offers it; and the reload a stale refusal
 * asks for. */
function EpicFormActions(props: {
  readonly submit: string;
  readonly busy: boolean;
  readonly onCancel: (() => void) | undefined;
  readonly onReload: (() => void) | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="primary" disabled={props.busy}>
        {props.submit}
      </Button>
      {props.onCancel === undefined ? null : (
        <Button onClick={props.onCancel}>{text({ id: "ui-cancel" })}</Button>
      )}
      {props.onReload === undefined ? null : (
        <EpicFormReload onReload={props.onReload} />
      )}
    </div>
  );
}

/** The fields a form is typed into. */
export type EpicFormFieldsDrawn = (props: {
  readonly form: EpicForm;
  readonly onChange: (form: EpicForm) => void;
}) => ReactNode;

export function EpicFormPanel(props: {
  readonly partition: PartitionIdentity;
  readonly held: EpicHeld;
  readonly submit: string;
  readonly onSaved: (saved: {
    readonly epic: number;
    readonly revision: number;
  }) => void;
  readonly fields: EpicFormFieldsDrawn;
  /** Leaves the form with nothing written, where it offers that. */
  readonly onCancel?: () => void;
}): ReactNode {
  const { partition, held } = props;
  const client = useQueryClient();
  const [form, setForm] = useState(held.form);
  const [opened, setOpened] = useState(held.revision);
  const [reloading, setReloading] = useState(false);
  const writing = useConsoleWrite(epicWrite(partition), { drawn: true });
  if (reloading && held.revision !== opened) {
    setReloading(false);
    setOpened(held.revision);
    setForm(held.form);
    writing.reset();
  }
  const faults = epicFormFaults(form);
  const request = epicWriteFrom(form, { epic: held.epic, revision: opened });
  const failure = writing.error?.failure;
  const refusedStale = failure?.outcome === "Conflict" && stale(failure.code);
  const Fields = props.fields;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (request === undefined || faults.length > 0) return;
        writing.mutate(request, {
          onSuccess: (saved) => {
            setOpened(saved.revision);
            props.onSaved(saved);
          },
        });
      }}
    >
      <Fields form={form} onChange={setForm} />
      <EpicFormFaults faults={faults} />
      {writing.error === null ? null : (
        <p className="notice notice-danger notice-inline" role="alert">
          <ConsoleWriteRefusedWords refused={writing.error} />
        </p>
      )}
      <EpicFormActions
        submit={props.submit}
        busy={writing.isPending || faults.length > 0}
        onCancel={props.onCancel}
        onReload={
          refusedStale
            ? () => {
                setReloading(true);
                void epicsInvalidated(client, partition);
              }
            : undefined
        }
      />
    </form>
  );
}
