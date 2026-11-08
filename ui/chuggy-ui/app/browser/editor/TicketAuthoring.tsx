/**
 * One ticket, typed either as the form or as YAML, over the same form value.
 *
 * The two are views of one thing, so switching is free in one direction and
 * asked of the text in the other: the form always reads as YAML, and YAML
 * reads back as a form only while nothing is wrong with it, so the switch back
 * waits until it does. A screen that finds YAML this browser kept for it opens
 * on that YAML, because the author was typing there when they left.
 *
 * A screen following the server draft it is open on says which seeding of the
 * form it draws, and the YAML is written again from the form on each new one;
 * it is told when YAML of the author's comes and goes, and may hold the submit
 * back while it says why above it.
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
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
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

/** What a mode is called where it is chosen: the form in the catalog's words,
 * and YAML by the name of the language. */
const authoringModeWords: Readonly<Record<AuthoringMode, Copy | string>> = {
  Form: { id: "ticket-authoring-mode-form" },
  YAML: "YAML",
};

/** Whether two forms say the same thing, which is what a screen is dirty by. */
function formsAgree(a: TicketCreationForm, b: TicketCreationForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What one submit would make of a form: a body, or the faults it earns. */
type Assembled =
  | { readonly assembled: "Body" }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

/** What a screen following its server draft hands the authoring. */
export interface AuthoringFollow {
  /** Which drawing of the form from a revision this is. */
  readonly seeding: number;
  readonly onAuthored: (authored: boolean) => void;
  readonly withheld: boolean;
}

export interface TicketAuthoringProps {
  /** The form as the screen first read it, which a key the YAML leaves out
   * keeps its value from and a screen is dirty against. */
  readonly initial: TicketCreationForm;
  readonly form: TicketCreationForm;
  readonly onForm: (form: TicketCreationForm) => void;
  readonly offers: readonly CreationOffer[];
  readonly repositories: readonly ProjectRepositoryResponse[];
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
  readonly following?: AuthoringFollow | undefined;
}

function YamlSide(props: TicketYamlAuthoringProps): ReactNode {
  const text = useCopyText();
  return (
    <EditorBoundary
      fallback={
        <Notice
          tone="danger"
          inline
          detail={text({ id: "ticket-authoring-yaml-unloaded" })}
        />
      }
    >
      <Suspense
        fallback={
          <p className="panel-note">
            {text({ id: "ticket-authoring-yaml-loading" })}
          </p>
        }
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
  const text = useCopyText();
  const word = (mode: AuthoringMode): string => {
    const words = authoringModeWords[mode];
    return typeof words === "string" ? words : text(words);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        label={text({ id: "ticket-authoring-mode-switch" })}
        options={authoringModes.map(word)}
        value={word(props.mode)}
        onChange={(value) => {
          const chosen = authoringModes.find((held) => word(held) === value);
          if (chosen !== undefined) props.onMode(chosen);
        }}
      />
      {props.stuck ? (
        <span className="text-ink-3 text-sm">
          {text({ id: "ticket-authoring-yaml-stuck" })}
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
  const held = props.form.images;
  const [kept] = useState(() => ticketYamlImagesStored(storeKey));
  return useMemo(
    () => ({
      base: initial,
      offers,
      repositories,
      images: [...new Set([...initial.images, ...held, ...kept])],
    }),
    [initial, offers, repositories, held, kept],
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
  const following = props.following;
  const busy = props.busy || following?.withheld === true;
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
          if (chosen === "Form") {
            ticketYamlForgotten(storeKey);
            following?.onAuthored(false);
          }
          setReadable(true);
          setMode(chosen);
        }}
      />
      {mode === "YAML" ? (
        <YamlSide
          key={following?.seeding ?? 0}
          context={context}
          form={sent}
          onForm={props.onForm}
          onReadable={setReadable}
          onAuthored={following?.onAuthored}
          faultsOf={faultsOf}
          storeKey={storeKey}
          submitLabel={props.submitLabel}
          submitEffect={props.submitEffect}
          submitStep={props.submitStep}
          busy={busy}
          onSubmit={props.onSubmit}
        />
      ) : (
        <>
          {props.fields}
          <FormSubmit
            label={props.submitLabel}
            effect={props.submitEffect}
            step={props.submitStep}
            busy={busy}
            onSubmit={() => {
              props.onSubmit(sent);
            }}
          />
        </>
      )}
    </>
  );
}
