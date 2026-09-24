/**
 * Everything a ticket's creation does not ask a human about, behind one
 * disclosure and prefilled from the initialization.
 *
 * Every field here offers exactly what the initialization offered and nothing
 * else, so a form cannot submit a value the project would refuse; what the
 * initialization derived is not drawn at all. The disclosure is the element's
 * own, so a closed panel costs no script.
 */

import type { ReactNode } from "react";

import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
import { creationOffered, creationStageLabel } from "../core/ticketCreation.ts";
import type {
  CreationStage,
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import { Button } from "./ui/Button.tsx";
import { Panel } from "./ui/Panel.tsx";

interface FormEdit {
  readonly form: TicketCreationForm;
  readonly onChange: (form: TicketCreationForm) => void;
}

function ChoiceRow<T>(props: {
  readonly label: string;
  readonly offered: readonly T[];
  readonly chosen: T;
  readonly render: (value: T) => string;
  readonly onChoose: (value: T) => void;
}): ReactNode {
  const options = creationOffered(props.offered, props.chosen, props.render);
  const { onChoose, render } = props;
  return (
    <label className="creation-row">
      <span>{props.label}</span>
      <select
        value={render(props.chosen)}
        onChange={(event) => {
          const found = options.find(
            (value) => render(value) === event.target.value,
          );
          if (found !== undefined) onChoose(found);
        }}
      >
        {options.map((value) => (
          <option key={render(value)} value={render(value)}>
            {render(value)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Dependencies(
  props: FormEdit & {
    readonly candidates: readonly number[];
    readonly truncated: boolean;
  },
): ReactNode {
  const { form, onChange } = props;
  if (props.candidates.length === 0)
    return <p className="panel-note">no ticket here can be depended on yet</p>;
  return (
    <fieldset className="creation-set">
      <legend>dependencies</legend>
      {props.candidates.map((candidate) => (
        <label key={candidate} className="creation-check">
          <input
            type="checkbox"
            checked={form.dependencies.includes(candidate)}
            onChange={(event) => {
              onChange({
                ...form,
                dependencies: event.target.checked
                  ? [...form.dependencies, candidate]
                  : form.dependencies.filter((held) => held !== candidate),
              });
            }}
          />
          <span>ticket {candidate}</span>
        </label>
      ))}
      {props.truncated ? (
        <p className="panel-note">
          this project has more tickets than the API offers as candidates
        </p>
      ) : null}
    </fieldset>
  );
}

/** The counts a stage's picker offers: every width up to what the project allows. */
function evaluatorCountsOffered(evaluatorsMax: number): readonly number[] {
  return Array.from({ length: evaluatorsMax }, (_, index) => index + 1);
}

/** A stage of the given width, its evaluators keyed densely from one. */
function stageOfCount(count: number): CreationStage {
  return {
    key: 1,
    evaluators: Array.from({ length: count }, (_, index) => ({
      key: index + 1,
    })),
  };
}

/** A program with every stage's key set to its position, the rule the wire holds it to. */
function programPositioned(program: readonly CreationStage[]): CreationStage[] {
  return program.map((stage, index) => ({ ...stage, key: index + 1 }));
}

function stageAdded(
  form: TicketCreationForm,
  evaluatorsMax: number,
): CreationStage[] {
  const last = form.program[form.program.length - 1];
  const count = Math.min(last?.evaluators.length ?? 1, evaluatorsMax);
  return programPositioned([...form.program, stageOfCount(count)]);
}

function Program(
  props: FormEdit & {
    readonly evaluatorsMax: number;
    readonly stagesMax: number;
  },
): ReactNode {
  const { form, evaluatorsMax, onChange } = props;
  const offered = evaluatorCountsOffered(evaluatorsMax);
  return (
    <fieldset className="creation-set">
      <legend>evaluation program</legend>
      {form.program.map((stage, index) => (
        <div
          key={`${String(index)}-${creationStageLabel(stage)}`}
          className="creation-stage"
        >
          <ChoiceRow
            label={`stage ${index + 1}`}
            offered={offered}
            chosen={stage.evaluators.length}
            render={(count) => String(count)}
            onChoose={(count) => {
              onChange({
                ...form,
                program: programPositioned(
                  form.program.map((held, at) =>
                    at === index ? stageOfCount(count) : held,
                  ),
                ),
              });
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              onChange({
                ...form,
                program: programPositioned(
                  form.program.filter((_, at) => at !== index),
                ),
              });
            }}
          >
            remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={form.program.length >= props.stagesMax}
        onClick={() => {
          onChange({ ...form, program: stageAdded(form, evaluatorsMax) });
        }}
      >
        add stage
      </Button>
    </fieldset>
  );
}

export function TicketCreationAdvanced(
  props: FormEdit & {
    readonly initialization: DraftInitializationResponse;
    readonly dependenciesLocked?: boolean;
  },
): ReactNode {
  const { form, initialization, onChange } = props;
  return (
    <Panel title="Advanced" collapsible={{ open: false }}>
      <div className="grid gap-2">
        {props.dependenciesLocked === true ? null : (
          <Dependencies
            form={form}
            onChange={onChange}
            candidates={initialization.dependencyCandidates}
            truncated={initialization.dependencyCandidatesTruncated}
          />
        )}
        <Program
          form={form}
          onChange={onChange}
          evaluatorsMax={initialization.choices.evaluatorsMax}
          stagesMax={initialization.choices.programStagesMax}
        />
      </div>
    </Panel>
  );
}
