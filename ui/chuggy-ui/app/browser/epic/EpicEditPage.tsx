/**
 * The epic's edit page, under the page's header with no tab current: its
 * title, which it needs, its summary counted against the most it may hold,
 * and its description as Markdown, each under its own label; which tickets it
 * holds changes on its Tickets tab.
 * Save sends at the revision the page read and returns to the Overview;
 * Cancel returns with nothing written. A reader who may not write epics is
 * sent to the Overview.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";

import { epicSummaryCharsMax } from "../../../../../src/contract/epics.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy, CopyText } from "../../core/copy.ts";
import { epicFormFrom } from "../../core/epics.ts";
import type { EpicForm } from "../../core/epics.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { EpicFormPanel } from "../EpicForm.tsx";
import type { EpicFormFaulted } from "../EpicForm.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Input } from "../ui/Input.tsx";
import { Textarea } from "../ui/Textarea.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicEdit.css";

/** A field's fault as its error, where it has one. */
function epicEditError(
  text: CopyText,
  fault: Copy | undefined,
): { readonly error?: string } {
  return fault === undefined ? {} : { error: text(fault) };
}

function EpicEditFields(props: {
  readonly form: EpicForm;
  readonly faulted: EpicFormFaulted;
  readonly onChange: (form: EpicForm) => void;
}): ReactNode {
  const text = useCopyText();
  const { form, faulted, onChange } = props;
  return (
    <div className="grid gap-4">
      <Input
        labelShown
        required
        label={text({ id: "epics-field-title" })}
        value={form.title}
        {...epicEditError(text, faulted.title)}
        onChange={(typed) => {
          onChange({ ...form, title: typed });
        }}
      />
      <Textarea
        labelShown
        label={text({ id: "epics-field-summary" })}
        hint={text({
          id: "epics-field-summary-count",
          args: {
            count: String([...form.summary].length),
            most: String(epicSummaryCharsMax),
          },
        })}
        value={form.summary}
        {...epicEditError(text, faulted.summary)}
        onChange={(typed) => {
          onChange({ ...form, summary: typed });
        }}
      />
      <Textarea
        labelShown
        label={text({ id: "epics-field-description" })}
        hint={text({ id: "epics-field-description-format" })}
        value={form.description}
        mono
        onChange={(typed) => {
          onChange({ ...form, description: typed });
        }}
      />
    </div>
  );
}

export function EpicEditPage(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const navigate = useNavigate();
  const { partition, epic, writing } = held;
  const overview = useCallback(() => {
    void navigate({
      to: "/$tenant/$project/epics/$epic",
      params: { ...partition, epic: String(epic) },
    });
  }, [navigate, partition, epic]);
  useEffect(() => {
    if (!writing) overview();
  }, [writing, overview]);
  const view = readValue(held.epicState);
  if (!writing) return null;
  if (view === undefined) return <PanelUnready state={held.epicState} />;
  return (
    <section className="epic-edit" aria-label={text({ id: "epics-edit" })}>
      <EpicFormPanel
        partition={partition}
        held={{
          epic: view.number,
          revision: view.revision,
          form: epicFormFrom(view),
        }}
        submit={text({ id: "epics-edit-save" })}
        fields={EpicEditFields}
        onSaved={overview}
        onCancel={overview}
      />
    </section>
  );
}
