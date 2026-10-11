/**
 * One ticket, typed either as the form or as YAML, over the same form value.
 *
 * The two are views of one thing, so switching is free in one direction and
 * asked of the text in the other: the form always reads as YAML, and YAML
 * reads back as a form only while nothing is wrong with it, so the switch back
 * waits until it does. A screen that finds YAML this browser kept for it opens
 * on that YAML, because the author was typing there when they left.
 *
 * Images are attached in the form alone, so the YAML may name only those the
 * screen first read, those the form held when the text was opened, and those
 * a text this browser kept was kept beside.
 *
 * The YAML side is a chunk of its own and this module names none of it but
 * the import, so a reader who never switches downloads neither the parser nor
 * the editor. Where the chunk cannot load, the form is still here.
 */

import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import type {
  CreationFault,
  CreationOffer,
  TicketCreationForm,
} from "../../core/ticketCreation.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";
import {
  EditorBoundary,
  ticketYamlForgotten,
  ticketYamlImagesStored,
  ticketYamlStored,
} from "./authoringGuards.tsx";
import type { TicketYamlAuthoringProps } from "./TicketYamlAuthoring.tsx";

const TicketYamlAuthoring = lazy(() => import("./TicketYamlAuthoring.tsx"));

const authoringModes = ["Form", "YAML"] as const;
type AuthoringMode = (typeof authoringModes)[number];

/** Whether two forms say the same thing, which is what a screen is dirty by. */
function formsAgree(a: TicketCreationForm, b: TicketCreationForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What one submit would make of a form: a body, or the faults it earns. */
type Assembled =
  | { readonly assembled: "Body" }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

export interface TicketAuthoringProps {
  /** The form as the screen first read it, which a key the YAML leaves out
   * keeps its value from and a screen is dirty against. */
  readonly initial: TicketCreationForm;
  readonly form: TicketCreationForm;
  readonly onForm: (form: TicketCreationForm) => void;
  readonly offers: readonly CreationOffer[];
  readonly repositories: readonly ProjectRepositoryResponse[];
  readonly dependenciesLocked: boolean;
  readonly assemble: (form: TicketCreationForm) => Assembled;
  /** The form with what the screen proposes for a box left empty, which is
   * what the Form side submits and the YAML is first written from. */
  readonly proposed?:
    ((form: TicketCreationForm) => TicketCreationForm) | undefined;
  /** The form as a screen draws it, fields and faults, for the Form side. */
  readonly fields: ReactNode;
  readonly storeKey: string;
  readonly submitLabel: string;
  /** What submitting does beyond what its label says, drawn beside it. */
  readonly submitEffect?: string | undefined;
  /** What a reader does about that effect, drawn after it. */
  readonly submitStep?: ReactNode;
  readonly busy: boolean;
  readonly onSubmit: (form: TicketCreationForm) => void;
  readonly onDirty?: ((dirty: boolean) => void) | undefined;
}

function YamlSide(props: TicketYamlAuthoringProps): ReactNode {
  return (
    <EditorBoundary
      fallback={
        <Notice
          tone="danger"
          inline
          detail="The YAML editor could not load; the form still holds this ticket."
        />
      }
    >
      <Suspense
        fallback={<p className="panel-note">loading the YAML editor…</p>}
      >
        <TicketYamlAuthoring {...props} />
      </Suspense>
    </EditorBoundary>
  );
}

function ModeSwitch(props: {
  readonly mode: AuthoringMode;
  readonly stuck: boolean;
  readonly onMode: (mode: AuthoringMode) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        label="Write the ticket as"
        options={authoringModes}
        value={props.mode}
        onChange={(value) => {
          const chosen = authoringModes.find((held) => held === value);
          if (chosen !== undefined) props.onMode(chosen);
        }}
      />
      {props.stuck ? (
        <span className="text-ink-3 text-sm">
          fix the YAML to switch back to the form
        </span>
      ) : null}
    </div>
  );
}

/** The form's submit, and the line saying what it does as its description,
 * with what a reader does about it after that line and outside the description. */
function FormSubmit(props: {
  readonly label: string;
  readonly effect: string | undefined;
  readonly step: ReactNode;
  readonly busy: boolean;
  readonly onSubmit: () => void;
}): ReactNode {
  const effect = useId();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        disabled={props.busy}
        {...(props.effect === undefined ? {} : { describedBy: effect })}
        onClick={props.onSubmit}
      >
        {props.label}
      </Button>
      {props.effect === undefined ? null : (
        <span className="text-ink-3 text-sm">
          <span id={effect}>{props.effect}</span>
          {props.step === undefined ? null : <> · {props.step}</>}
        </span>
      )}
    </div>
  );
}

/** What the YAML is read against, the images in it being the ones this
 * screen knows the project holds. */
function useYamlContext(props: TicketAuthoringProps) {
  const { initial, offers, repositories, storeKey } = props;
  const locked = props.dependenciesLocked;
  const held = props.form.images;
  const [kept] = useState(() => ticketYamlImagesStored(storeKey));
  return useMemo(
    () => ({
      base: initial,
      offers,
      repositories,
      dependenciesLocked: locked,
      images: [...new Set([...initial.images, ...held, ...kept])],
    }),
    [initial, offers, repositories, locked, held, kept],
  );
}

export function TicketAuthoring(props: TicketAuthoringProps): ReactNode {
  const { assemble, initial, onDirty } = props;
  const sent = props.proposed?.(props.form) ?? props.form;
  const storeKey = props.storeKey;
  const [mode, setMode] = useState<AuthoringMode>(() =>
    ticketYamlStored(storeKey) === undefined ? "Form" : "YAML",
  );
  const [readable, setReadable] = useState(true);
  const stuck = mode === "YAML" && !readable;
  const dirty = !formsAgree(props.form, initial) || stuck;
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  const context = useYamlContext(props);
  const faultsOf = (held: TicketCreationForm): readonly CreationFault[] => {
    const assembled = assemble(held);
    return assembled.assembled === "Faults" ? assembled.faults : [];
  };
  return (
    <>
      <ModeSwitch
        mode={mode}
        stuck={stuck}
        onMode={(chosen) => {
          if (chosen === "Form" && stuck) return;
          if (chosen === "Form") ticketYamlForgotten(storeKey);
          setReadable(true);
          setMode(chosen);
        }}
      />
      {mode === "YAML" ? (
        <YamlSide
          context={context}
          form={sent}
          onForm={props.onForm}
          onReadable={setReadable}
          faultsOf={faultsOf}
          storeKey={storeKey}
          submitLabel={props.submitLabel}
          submitEffect={props.submitEffect}
          submitStep={props.submitStep}
          busy={props.busy}
          onSubmit={props.onSubmit}
        />
      ) : (
        <>
          {props.fields}
          <FormSubmit
            label={props.submitLabel}
            effect={props.submitEffect}
            step={props.submitStep}
            busy={props.busy}
            onSubmit={() => {
              props.onSubmit(sent);
            }}
          />
        </>
      )}
    </>
  );
}
