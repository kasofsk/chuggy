/**
 * The ticket as YAML: the text, what is wrong with it, and the submit that
 * shows what it will send before it sends it.
 *
 * The text is the author's from the first keystroke and is kept in this
 * browser as it is typed. Every text that reads as a form is handed up as
 * that form, so the form this screen switches back to is the one the text
 * last said. The editor itself is a second chunk: where it cannot load, a
 * plain text area holds the same text, and the problems are listed beneath
 * it whichever is drawn.
 *
 * It is the default export because it is loaded as a chunk of its own, the
 * YAML parser with it.
 */

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type {
  CreationFault,
  TicketCreationForm,
} from "../../core/ticketCreation.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  EditorBoundary,
  ticketYamlForgotten,
  ticketYamlImagesKept,
  ticketYamlKept,
  ticketYamlStored,
} from "./authoringGuards.tsx";
import {
  ticketYamlFaultProblems,
  ticketYamlOf,
  ticketYamlRead,
  ticketYamlVocabulary,
} from "./ticketYaml.ts";
import type { TicketYamlContext, TicketYamlProblem } from "./ticketYaml.ts";

import "./TicketEditor.css";

const TicketEditor = lazy(() => import("./TicketEditor.tsx"));

export interface TicketYamlAuthoringProps {
  readonly context: TicketYamlContext;
  /** The form this screen holds now, which the text starts from where
   * nothing was kept. */
  readonly form: TicketCreationForm;
  readonly onForm: (form: TicketCreationForm) => void;
  readonly onReadable: (readable: boolean) => void;
  readonly faultsOf: (form: TicketCreationForm) => readonly CreationFault[];
  readonly storeKey: string;
  readonly submitLabel: string;
  readonly submitEffect?: string | undefined;
  readonly submitStep?: ReactNode;
  readonly busy: boolean;
  readonly onSubmit: (form: TicketCreationForm) => void;
}

/** The line a character offset falls on, counted from one as an editor does. */
function ticketYamlLineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function ticketYamlProblemsSentence(count: number): string {
  if (count === 0) return "Nothing is wrong with this ticket.";
  return count === 1
    ? "One problem must be fixed before this ticket can be sent."
    : `${String(count)} problems must be fixed before this ticket can be sent.`;
}

function ProblemList(props: {
  readonly text: string;
  readonly problems: readonly TicketYamlProblem[];
}): ReactNode {
  if (props.problems.length === 0) return null;
  return (
    <ul className="ticket-yaml-problems" aria-label="Problems">
      {props.problems.map((problem, index) => (
        <li key={index}>
          line {ticketYamlLineOf(props.text, problem.from)}: {problem.message}
        </li>
      ))}
    </ul>
  );
}

/** The submit, asked first: the text it will send, and whether it can. */
function YamlSubmit(props: {
  readonly text: string;
  readonly problems: number;
  readonly form: TicketCreationForm | undefined;
  readonly label: string;
  readonly effect: string | undefined;
  readonly step: ReactNode;
  readonly busy: boolean;
  readonly onSubmit: (form: TicketCreationForm) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const effect = useId();
  const form = props.form;
  return (
    <Dialog
      title={`${props.label}?`}
      trigger={props.label}
      triggerVariant="primary"
      triggerSize="md"
      triggerDisabled={props.busy}
      open={open}
      onOpenChange={setOpen}
    >
      <pre className="ticket-yaml-confirm-source">{props.text}</pre>
      <p className="text-ink-2 m-0 text-sm">
        {ticketYamlProblemsSentence(props.problems)}
      </p>
      {props.effect === undefined ? null : (
        <p className="text-ink-3 m-0 text-sm">
          <span id={effect}>{props.effect}</span>
          {props.step === undefined ? null : <> · {props.step}</>}
        </p>
      )}
      <Button
        variant="primary"
        disabled={props.problems > 0 || form === undefined}
        {...(props.effect === undefined ? {} : { describedBy: effect })}
        onClick={() => {
          if (form === undefined) return;
          setOpen(false);
          props.onSubmit(form);
        }}
      >
        {props.label}
      </Button>
    </Dialog>
  );
}

/**
 * The text and what it reads as. The project's offer is read once: a context
 * that changed identity under every render would re-read the text, and hand
 * up a form, on each.
 */
function useYamlText(props: TicketYamlAuthoringProps) {
  const storeKey = props.storeKey;
  const [context] = useState(props.context);
  const handed = useRef(props);
  useEffect(() => {
    handed.current = props;
  });
  const [kept] = useState(() => ticketYamlStored(storeKey));
  const [text, setText] = useState(
    () => kept ?? ticketYamlOf(props.form, context),
  );
  const [restored, setRestored] = useState(kept !== undefined);
  const reading = useMemo(() => ticketYamlRead(text, context), [text, context]);
  const read = reading.form;
  const problems = [
    ...reading.problems,
    ...(read === undefined
      ? []
      : ticketYamlFaultProblems(props.faultsOf(read), reading.keys)),
  ];
  const vocabulary = useMemo(
    () => ticketYamlVocabulary(read ?? context.base, context),
    [read, context],
  );
  useEffect(() => {
    if (read !== undefined) handed.current.onForm(read);
    handed.current.onReadable(read !== undefined);
  }, [read]);
  return {
    text,
    read,
    problems,
    vocabulary,
    restored,
    typed: (next: string): void => {
      setText(next);
      ticketYamlKept(storeKey, next);
      ticketYamlImagesKept(storeKey, context.images);
    },
    discarded: (): void => {
      ticketYamlForgotten(storeKey);
      setText(ticketYamlOf(context.base, context));
      setRestored(false);
    },
  };
}

function RestoredNote(props: { readonly onDiscard: () => void }): ReactNode {
  return (
    <Notice
      tone="info"
      inline
      detail="Restored the unsaved YAML this browser kept for this ticket."
    >
      <Button size="sm" onClick={props.onDiscard}>
        Discard it
      </Button>
    </Notice>
  );
}

export default function TicketYamlAuthoring(
  props: TicketYamlAuthoringProps,
): ReactNode {
  const yaml = useYamlText(props);
  const fallback = (
    <textarea
      className="ticket-editor-fallback"
      aria-label="Ticket YAML"
      spellCheck={false}
      value={yaml.text}
      onChange={(event) => {
        yaml.typed(event.target.value);
      }}
    />
  );
  return (
    <div data-fills-width className="grid min-w-0 gap-3">
      {yaml.restored ? <RestoredNote onDiscard={yaml.discarded} /> : null}
      <EditorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <TicketEditor
            value={yaml.text}
            onChange={yaml.typed}
            problems={yaml.problems}
            vocabulary={yaml.vocabulary}
          />
        </Suspense>
      </EditorBoundary>
      <ProblemList text={yaml.text} problems={yaml.problems} />
      <div>
        <YamlSubmit
          text={yaml.text}
          problems={yaml.problems.length}
          form={yaml.read}
          label={props.submitLabel}
          effect={props.submitEffect}
          step={props.submitStep}
          busy={props.busy}
          onSubmit={props.onSubmit}
        />
      </div>
    </div>
  );
}
