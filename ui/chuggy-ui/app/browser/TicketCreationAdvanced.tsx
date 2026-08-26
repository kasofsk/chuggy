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
import {
  creationFanoutLabel,
  creationFinalizationLabel,
  creationOffered,
  creationReworkLabel,
  creationStageLabel,
} from "../core/ticketCreation.ts";
import type {
  CreationStage,
  TicketCreationForm,
} from "../core/ticketCreation.ts";

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

function stageAdded(
  form: TicketCreationForm,
  offered: readonly CreationStage[],
): CreationStage[] {
  const next = offered[0] ?? form.program[form.program.length - 1];
  return next === undefined ? [...form.program] : [...form.program, next];
}

function Program(
  props: FormEdit & {
    readonly offered: readonly CreationStage[];
    readonly stagesMax: number;
  },
): ReactNode {
  const { form, offered, onChange } = props;
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
            chosen={stage}
            render={creationStageLabel}
            onChoose={(chosen) => {
              onChange({
                ...form,
                program: form.program.map((held, at) =>
                  at === index ? chosen : held,
                ),
              });
            }}
          />
          <button
            type="button"
            onClick={() => {
              onChange({
                ...form,
                program: form.program.filter((_, at) => at !== index),
              });
            }}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={form.program.length >= props.stagesMax}
        onClick={() => {
          onChange({ ...form, program: stageAdded(form, offered) });
        }}
      >
        add stage
      </button>
    </fieldset>
  );
}

function Pricing(
  props: FormEdit & {
    readonly choices: DraftInitializationResponse["choices"];
  },
): ReactNode {
  const { choices, form, onChange } = props;
  return (
    <>
      <ChoiceRow
        label="work fanout"
        offered={choices.workFanouts}
        chosen={form.workFanout}
        render={creationFanoutLabel}
        onChoose={(workFanout) => {
          onChange({ ...form, workFanout });
        }}
      />
      <ChoiceRow
        label="rework policy"
        offered={choices.reworkPolicies}
        chosen={form.reworkPolicy}
        render={creationReworkLabel}
        onChoose={(reworkPolicy) => {
          onChange({ ...form, reworkPolicy });
        }}
      />
      <ChoiceRow
        label="finalization pricing"
        offered={choices.finalizationPricings}
        chosen={form.finalizationPricing}
        render={creationFinalizationLabel}
        onChoose={(finalizationPricing) => {
          onChange({ ...form, finalizationPricing });
        }}
      />
      <ChoiceRow
        label="resume pricing"
        offered={choices.resumePricings}
        chosen={form.resumePricing}
        render={(value) => value}
        onChoose={(resumePricing) => {
          onChange({ ...form, resumePricing });
        }}
      />
      <ChoiceRow
        label="finalizer"
        offered={choices.finalizers}
        chosen={form.finalizer}
        render={(value) => value}
        onChoose={(finalizer) => {
          onChange({ ...form, finalizer });
        }}
      />
    </>
  );
}

export function TicketCreationAdvanced(
  props: FormEdit & {
    readonly initialization: DraftInitializationResponse;
  },
): ReactNode {
  const { form, initialization, onChange } = props;
  return (
    <details className="creation-advanced">
      <summary>advanced</summary>
      <Dependencies
        form={form}
        onChange={onChange}
        candidates={initialization.dependencyCandidates}
        truncated={initialization.dependencyCandidatesTruncated}
      />
      <Program
        form={form}
        onChange={onChange}
        offered={initialization.choices.stages}
        stagesMax={initialization.choices.programStagesMax}
      />
      <Pricing
        form={form}
        onChange={onChange}
        choices={initialization.choices}
      />
    </details>
  );
}
