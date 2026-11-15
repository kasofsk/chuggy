/**
 * The form an epic is revised through: its content as typed, each fault it
 * has before it is sent beside the field it is about, and the refusal the API
 * answered, beside its field where it is about one and above the actions
 * where it is not.
 *
 * A revision is sent with the revision it was read at, so one made over
 * another's is refused as stale and the form offers to read the epic again
 * rather than send it a second time. What is typed stands on that revision
 * until the form saves it or the reader asks for the epic again: a read of a
 * later one in between leaves it as typed.
 *
 * A save the form or the API refuses moves focus to the first field it is
 * about. Leaving with what was typed unsaved asks first.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import type { ConsoleWriteRefused } from "../core/consoleWrite.ts";
import type { Copy } from "../core/copy.ts";
import {
  epicFormChanged,
  epicFormFaults,
  epicFormFieldOf,
  epicWrite,
  epicWriteFrom,
  epicWriteRefusal,
  epicsInvalidated,
} from "../core/epics.ts";
import type { EpicForm, EpicFormField } from "../core/epics.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "./consoleWrite.tsx";
import { useAuthoringGuards } from "./editor/authoringGuards.tsx";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

/** The epic a form revises, at the revision it was read at. */
export interface EpicHeld {
  readonly epic: number;
  readonly revision: number;
  readonly form: EpicForm;
}

/** What is wrong with each field, by the field it is about. */
export type EpicFormFaulted = Readonly<Partial<Record<EpicFormField, Copy>>>;

/** A revision a sibling's write has overtaken, which only reading the epic again can mend. */
function stale(code: string | undefined): boolean {
  return code === "StaleRevision";
}

/** The refusal's words, as the API answered them, where they are about one
 * field. */
function epicFormPanelRefusedField(
  refused: ConsoleWriteRefused | null,
): { readonly field: EpicFormField; readonly said: Copy } | undefined {
  if (refused?.failure === undefined) return undefined;
  const said = epicWriteRefusal(refused.failure);
  const field = epicFormFieldOf(said);
  return field === undefined ? undefined : { field, said };
}

/** Each field's first fault, and the refusal about one where none is typed. */
function epicFormPanelFaulted(
  faults: readonly Copy[],
  refused: ReturnType<typeof epicFormPanelRefusedField>,
): EpicFormFaulted {
  const faulted: Partial<Record<EpicFormField, Copy>> = {};
  for (const fault of faults) {
    const field = epicFormFieldOf(fault);
    if (field !== undefined) faulted[field] ??= fault;
  }
  if (refused !== undefined) faulted[refused.field] ??= refused.said;
  return faulted;
}

/** What is wrong with the whole epic rather than one field: a fault the
 * fields cannot show, and a refusal about none of them, with the reload a
 * stale one asks for. */
function EpicFormPanelWhole(props: {
  readonly faults: readonly Copy[];
  readonly refused: ConsoleWriteRefused | null;
  readonly onReload: () => void;
}): ReactNode {
  const text = useCopyText();
  const failure = props.refused?.failure;
  const refusedStale = failure?.outcome === "Conflict" && stale(failure.code);
  return (
    <>
      {props.faults.length === 0 ? null : (
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
      )}
      {props.refused === null ? null : (
        <div className="epic-form-refused">
          <p className="notice notice-danger notice-inline" role="alert">
            <ConsoleWriteRefusedWords refused={props.refused} />
          </p>
          {!refusedStale ? null : (
            <Button variant="quiet" onClick={props.onReload}>
              {text({ id: "epics-reload" })}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** Save, and Cancel where the form offers it, stacked on a narrow page. */
function EpicFormActions(props: {
  readonly submit: string;
  readonly busy: boolean;
  readonly onCancel: (() => void) | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="epic-form-actions">
      <Button type="submit" variant="primary" disabled={props.busy}>
        {props.submit}
      </Button>
      {props.onCancel === undefined ? null : (
        <Button variant="quiet" onClick={props.onCancel}>
          {text({ id: "ui-cancel" })}
        </Button>
      )}
    </div>
  );
}

/** The fields a form is typed into, each drawn with its own fault. */
export type EpicFormFieldsDrawn = (props: {
  readonly form: EpicForm;
  readonly faulted: EpicFormFaulted;
  readonly onChange: (form: EpicForm) => void;
}) => ReactNode;

/** Focus on the first field a failed save is about, once the fields that
 * failure marks are drawn; what it returns is called on each failed save. */
function useEpicFormPanelFocus(
  form: RefObject<HTMLFormElement | null>,
): () => void {
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    if (failures === 0) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [form, failures]);
  return () => {
    setFailures((count) => count + 1);
  };
}

/** What is typed, the revision it stands on and whether it differs from the
 * epic as read there; each taken again from `held` once a reload that was
 * asked for reads a later revision, when `reloaded` is called. */
function useEpicFormPanelTyped(held: EpicHeld, reloaded: () => void) {
  const [form, setForm] = useState(held.form);
  const [read, setRead] = useState(held.form);
  const [opened, setOpened] = useState(held.revision);
  const [reloading, setReloading] = useState(false);
  if (reloading && held.revision !== opened) {
    setReloading(false);
    setOpened(held.revision);
    setForm(held.form);
    setRead(held.form);
    reloaded();
  }
  return {
    form,
    setForm,
    opened,
    changed: epicFormChanged(read, form),
    saved: (revision: number) => {
      setOpened(revision);
      setRead(form);
    },
    reload: () => {
      setReloading(true);
    },
  };
}

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
  const writing = useConsoleWrite(epicWrite(partition), { drawn: true });
  const typed = useEpicFormPanelTyped(held, writing.reset);
  const formElement = useRef<HTMLFormElement>(null);
  const failed = useEpicFormPanelFocus(formElement);
  const guard = useAuthoringGuards(typed.changed, {
    id: "epics-leave-question",
  });
  const faults = epicFormFaults(typed.form);
  const request = epicWriteFrom(typed.form, {
    epic: held.epic,
    revision: typed.opened,
  });
  const refusedField = epicFormPanelRefusedField(writing.error);
  const Fields = props.fields;
  return (
    <form
      ref={formElement}
      className="epic-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (request === undefined || faults.length > 0) {
          failed();
          return;
        }
        writing.mutate(request, {
          onSuccess: (saved) => {
            typed.saved(saved.revision);
            guard.release();
            props.onSaved(saved);
          },
          onError: failed,
        });
      }}
    >
      <Fields
        form={typed.form}
        faulted={epicFormPanelFaulted(faults, refusedField)}
        onChange={typed.setForm}
      />
      <EpicFormPanelWhole
        faults={faults.filter((fault) => epicFormFieldOf(fault) === undefined)}
        refused={refusedField === undefined ? writing.error : null}
        onReload={() => {
          typed.reload();
          void epicsInvalidated(client, partition);
        }}
      />
      <EpicFormActions
        submit={props.submit}
        busy={writing.isPending}
        onCancel={props.onCancel}
      />
    </form>
  );
}
