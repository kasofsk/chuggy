/**
 * Everything a ticket's creation does not ask a human about, behind one
 * disclosure and prefilled from the initialization.
 *
 * Every field here offers exactly what the initialization offered and nothing
 * else, so a form cannot submit a value the project would refuse; what the
 * initialization derived is not drawn at all. A reader who may not skip
 * planned evaluations is offered no program that runs less than its plan. The
 * disclosure is the element's own, so a closed panel costs no script.
 */

import type { ReactNode } from "react";

import {
  configurationFollowings,
  type ConfigurationFollowing,
} from "../../../../src/contract/configurationDocument.ts";
import {
  configurationFollowingOf,
  type ConfigurationSelection,
} from "../../../../src/contract/configurationSelection.ts";
import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
import { configurationCatalogOf } from "../core/configurationCatalog.ts";
import {
  programPlanned,
  programShort,
  programStageLeast,
} from "../core/programPlan.ts";
import type { PlannedTask } from "../core/programPlan.ts";
import {
  creationOffered,
  creationStageLabel,
  creationStageOf,
} from "../core/ticketCreation.ts";
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
          const found = options.findIndex(
            (value) => render(value) === event.target.value,
          );
          if (found !== -1) onChoose(options[found] as T);
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
    return <p className="panel-note">No tickets to depend on</p>;
  return (
    <fieldset className="creation-set">
      <legend>Dependencies</legend>
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
          <span>Ticket {candidate}</span>
        </label>
      ))}
      {props.truncated ? (
        <p className="panel-note">Not every ticket is listed</p>
      ) : null}
    </fieldset>
  );
}

/** The selection with the revision it follows chosen, or left to its catalog. */
function configurationVersionChosen(
  selection: ConfigurationSelection,
  configuration: ConfigurationFollowing | undefined,
): ConfigurationSelection {
  const rest = { ...selection };
  delete rest.configuration;
  return configuration === undefined ? rest : { ...rest, configuration };
}

/**
 * Which revision of a catalog the ticket runs on: one it chose, kept as chosen
 * even where it is the default, or none, which is the catalog's default.
 */
function ConfigurationVersion(
  props: FormEdit & { readonly initialization: DraftInitializationResponse },
): ReactNode {
  const { form, onChange } = props;
  const catalog = configurationCatalogOf(
    props.initialization.configuration.canonical,
  );
  if (catalog === undefined) return null;
  const defaulted = configurationFollowingOf(undefined, catalog.defaults);
  return (
    <ChoiceRow<ConfigurationFollowing | undefined>
      label="Configuration version"
      offered={[undefined, ...configurationFollowings]}
      chosen={form.selection.configuration}
      render={(value) => value ?? `Default (${defaulted})`}
      onChoose={(value) => {
        onChange({
          ...form,
          selection: configurationVersionChosen(form.selection, value),
        });
      }}
    />
  );
}

/** The counts a stage's picker offers: every width from the least it may hold up to what the project allows. */
function evaluatorCountsOffered(
  least: number,
  evaluatorsMax: number,
): readonly number[] {
  return Array.from(
    { length: Math.max(evaluatorsMax - least + 1, 0) },
    (_, index) => least + index,
  );
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
  return programPositioned([...form.program, creationStageOf(count, 1)]);
}

/** A program without the stage at `index`, the ones after it moved up. */
function stageRemoved(
  form: TicketCreationForm,
  index: number,
): CreationStage[] {
  return programPositioned(form.program.filter((_, at) => at !== index));
}

function Program(
  props: FormEdit & {
    readonly evaluatorsMax: number;
    readonly stagesMax: number;
    /** What the plan runs, for a reader who may not leave any of it out. */
    readonly planned: readonly PlannedTask[] | undefined;
  },
): ReactNode {
  const { form, evaluatorsMax, onChange, planned } = props;
  return (
    <fieldset className="creation-set">
      <legend>Evaluators per stage</legend>
      {form.program.map((stage, index) => (
        <div
          key={`${String(index)}-${creationStageLabel(stage)}`}
          className="creation-stage"
        >
          <ChoiceRow
            label={`Stage ${index + 1}`}
            offered={evaluatorCountsOffered(
              planned === undefined ? 1 : programStageLeast(planned, index + 1),
              evaluatorsMax,
            )}
            chosen={stage.evaluators.length}
            render={(count) => String(count)}
            onChoose={(count) => {
              onChange({
                ...form,
                program: programPositioned(
                  form.program.map((held, at) =>
                    at === index ? creationStageOf(count, 1) : held,
                  ),
                ),
              });
            }}
          />
          {planned !== undefined &&
          programShort(planned, stageRemoved(form, index)) ? null : (
            <Button
              size="sm"
              onClick={() => {
                onChange({ ...form, program: stageRemoved(form, index) });
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button
        size="sm"
        disabled={form.program.length >= props.stagesMax}
        onClick={() => {
          onChange({ ...form, program: stageAdded(form, evaluatorsMax) });
        }}
      >
        Add stage
      </Button>
    </fieldset>
  );
}

export function TicketCreationAdvanced(
  props: FormEdit & {
    readonly initialization: DraftInitializationResponse;
    /** Whether the reader may draw a program that runs less than its plan; absent, they may. */
    readonly maySkipPlanned?: boolean;
  },
): ReactNode {
  const { form, initialization, onChange } = props;
  return (
    <Panel title="Advanced" collapsible={{ open: false }}>
      <div className="grid gap-2">
        <ConfigurationVersion
          form={form}
          onChange={onChange}
          initialization={initialization}
        />
        <Dependencies
          form={form}
          onChange={onChange}
          candidates={initialization.dependencyCandidates}
          truncated={initialization.dependencyCandidatesTruncated}
        />
        <Program
          form={form}
          onChange={onChange}
          evaluatorsMax={initialization.choices.evaluatorsMax}
          stagesMax={initialization.choices.programStagesMax}
          planned={
            props.maySkipPlanned === false
              ? programPlanned(initialization)
              : undefined
          }
        />
      </div>
    </Panel>
  );
}
