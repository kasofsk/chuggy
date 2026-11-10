/**
 * The epic's edit page, under the page's header with no tab current: its
 * title, its summary counted against the most it may hold, its description
 * as Markdown, and its tickets. Save sends at the revision the page read and
 * returns to the Overview; Cancel returns with nothing written. A reader who
 * may not write epics is sent to the Overview.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";

import { epicSummaryCharsMax } from "../../../../../src/contract/epics.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicFormFrom } from "../../core/epics.ts";
import type { EpicForm } from "../../core/epics.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { EpicFormPanel } from "../EpicForm.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Input } from "../ui/Input.tsx";
import { Textarea } from "../ui/Textarea.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicEdit.css";

/** A field's name over it, with what is said of it at the right. */
function EpicEditField(props: {
  readonly name: string;
  readonly aside?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="epic-edit-field">
      <div className="epic-edit-field-head" aria-hidden="true">
        <span className="epic-edit-field-name">{props.name}</span>
        {props.aside === undefined ? null : (
          <span className="epic-edit-field-aside num">{props.aside}</span>
        )}
      </div>
      {props.children}
    </div>
  );
}

function EpicEditFields(props: {
  readonly form: EpicForm;
  readonly onChange: (form: EpicForm) => void;
}): ReactNode {
  const text = useCopyText();
  const { form, onChange } = props;
  const title = text({ id: "epics-field-title" });
  const summary = text({ id: "epics-field-summary" });
  const description = text({ id: "epics-field-description" });
  const tickets = text({ id: "epics-field-tickets" });
  return (
    <div className="grid gap-4">
      <EpicEditField name={title}>
        <Input
          label={title}
          value={form.title}
          onChange={(typed) => {
            onChange({ ...form, title: typed });
          }}
        />
      </EpicEditField>
      <EpicEditField
        name={summary}
        aside={text({
          id: "epics-field-summary-count",
          args: {
            count: String([...form.summary].length),
            most: String(epicSummaryCharsMax),
          },
        })}
      >
        <Textarea
          label={summary}
          value={form.summary}
          onChange={(typed) => {
            onChange({ ...form, summary: typed });
          }}
        />
      </EpicEditField>
      <EpicEditField
        name={description}
        aside={text({ id: "epics-field-description-format" })}
      >
        <Textarea
          label={description}
          value={form.description}
          mono
          onChange={(typed) => {
            onChange({ ...form, description: typed });
          }}
        />
      </EpicEditField>
      <EpicEditField name={tickets}>
        <Input
          label={tickets}
          placeholder={text({ id: "epics-field-tickets-placeholder" })}
          value={form.tickets}
          onChange={(typed) => {
            onChange({ ...form, tickets: typed });
          }}
        />
      </EpicEditField>
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
