/**
 * The form an epic is made and revised through: its content as typed, the
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
  epicFormEmpty,
  epicFormFaults,
  epicWrite,
  epicWriteFrom,
  epicsInvalidated,
} from "../core/epics.ts";
import type { EpicForm } from "../core/epics.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "./consoleWrite.tsx";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";
import { Textarea } from "./ui/Textarea.tsx";

/** The epic a form revises, at the revision it was read at; none where it makes one. */
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

export function EpicFormFields(props: {
  readonly form: EpicForm;
  readonly onChange: (form: EpicForm) => void;
}): ReactNode {
  const text = useCopyText();
  const { form, onChange } = props;
  return (
    <div className="grid gap-3">
      <Input
        label={text({ id: "epics-field-title" })}
        value={form.title}
        onChange={(title) => {
          onChange({ ...form, title });
        }}
      />
      <Input
        label={text({ id: "epics-field-summary" })}
        value={form.summary}
        onChange={(summary) => {
          onChange({ ...form, summary });
        }}
      />
      <Textarea
        label={text({ id: "epics-field-description" })}
        value={form.description}
        onChange={(description) => {
          onChange({ ...form, description });
        }}
      />
      <Input
        label={text({ id: "epics-field-tickets" })}
        placeholder={text({ id: "epics-field-tickets-placeholder" })}
        value={form.tickets}
        onChange={(tickets) => {
          onChange({ ...form, tickets });
        }}
      />
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <span>{text({ id: "epics-visibility" })}</span>
        <Picker
          label={text({ id: "epics-visibility" })}
          value={form.visibility}
          options={[
            { value: "Active", text: text({ id: "epics-visibility-active" }) },
            {
              value: "Archived",
              text: text({ id: "epics-visibility-archived" }),
            },
          ]}
          onChoose={(visibility) => {
            onChange({
              ...form,
              visibility: visibility === "Archived" ? "Archived" : "Active",
            });
          }}
        />
      </div>
    </div>
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

export function EpicFormPanel(props: {
  readonly partition: PartitionIdentity;
  readonly held: EpicHeld | undefined;
  readonly submit: string;
  readonly onSaved: (saved: {
    readonly epic: number;
    readonly revision: number;
  }) => void;
}): ReactNode {
  const { partition, held } = props;
  const client = useQueryClient();
  const [form, setForm] = useState(held?.form ?? epicFormEmpty);
  const [opened, setOpened] = useState(held?.revision);
  const [reloading, setReloading] = useState(false);
  const writing = useConsoleWrite(epicWrite(partition), { drawn: true });
  if (reloading && held?.revision !== opened) {
    setReloading(false);
    setOpened(held?.revision);
    setForm(held?.form ?? epicFormEmpty);
    writing.reset();
  }
  const faults = epicFormFaults(form);
  const request = epicWriteFrom(
    form,
    held === undefined || opened === undefined
      ? undefined
      : { epic: held.epic, revision: opened },
  );
  const failure = writing.error?.failure;
  const refusedStale = failure?.outcome === "Conflict" && stale(failure.code);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (request === undefined || faults.length > 0) return;
        writing.mutate(request, {
          onSuccess: (saved) => {
            if (held !== undefined) setOpened(saved.revision);
            props.onSaved(saved);
          },
        });
      }}
    >
      <EpicFormFields form={form} onChange={setForm} />
      <EpicFormFaults faults={faults} />
      {writing.error === null ? null : (
        <p className="notice notice-danger notice-inline" role="alert">
          <ConsoleWriteRefusedWords refused={writing.error} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={writing.isPending || faults.length > 0}>
          {props.submit}
        </Button>
        {refusedStale ? (
          <EpicFormReload
            onReload={() => {
              setReloading(true);
              void epicsInvalidated(client, partition);
            }}
          />
        ) : null}
      </div>
    </form>
  );
}
