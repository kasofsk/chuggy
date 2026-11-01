/**
 * What the register command a token is handed over in declares, asked before
 * the token is minted: the package the machine runs and, folded away since few
 * runners need either, whether it runs work on itself and the capabilities it
 * declares it meets. Nothing is minted where what was typed is not a
 * capability, the fold opened to say why, and a refused mint returns to the ask.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { WorkerPoolTokenResponse } from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "../core/apiRequest.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { panelReason } from "../core/freshness.ts";
import { runnerAskRead, runnerPackages } from "../core/runners.ts";
import type {
  RunnerAsk,
  RunnerKind,
  RunnerPackageName,
} from "../core/runners.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import type { ConsoleWriteShown, ConsoleWriting } from "./consoleWrite.tsx";
import { Button } from "./ui/Button.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Input } from "./ui/Input.tsx";
import { RunnerSteps, useFocusedUnheld } from "./RunnerSteps.tsx";
import { Notice } from "./ui/Notice.tsx";
import { ToggleGroup } from "./ui/ToggleGroup.tsx";

const runnerPackageNames = Object.keys(runnerPackages) as RunnerPackageName[];

/** The machine a runner is made of. */
function RunnerMachine(props: {
  readonly chosen: RunnerPackageName;
  readonly onChoose: (chosen: RunnerPackageName) => void;
}): ReactNode {
  const offered = runnerPackages[props.chosen];
  return (
    <ToggleGroup
      label="Machine"
      options={runnerPackageNames.map((name) => runnerPackages[name].label)}
      value={offered.label}
      onChange={(label) => {
        const name = runnerPackageNames.find(
          (each) => runnerPackages[each].label === label,
        );
        if (name !== undefined) props.onChoose(name);
      }}
    />
  );
}

function RunnerHost(props: {
  readonly host: boolean;
  readonly onHost: (host: boolean) => void;
}): ReactNode {
  return (
    <div className="grid gap-1">
      <Checkbox
        label="Run jobs without a container"
        checked={props.host}
        onChange={props.onHost}
      />
      <span className="text-xs font-regular">
        Jobs with no image run directly on this machine, as you.
      </span>
    </div>
  );
}

function RunnerCapabilities(props: {
  readonly typed: string;
  readonly onType: (typed: string) => void;
  readonly fault: string | undefined;
}): ReactNode {
  const faultId = useId();
  return (
    <label className="grid w-full max-w-md gap-1 text-sm font-medium text-ink-3">
      Capabilities
      <Input
        label="Capabilities"
        value={props.typed}
        onChange={props.onType}
        invalid={props.fault !== undefined}
        describedBy={faultId}
      />
      <span
        id={faultId}
        className={`text-xs ${props.fault === undefined ? "font-regular" : "text-tone-fail"}`}
      >
        {props.fault ?? "Optional · what a task may require, like Tool:Bazel"}
      </span>
    </label>
  );
}

/** What few runners need, folded away until asked for. */
function RunnerAdvanced(props: {
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly host: boolean;
  readonly onHost: (host: boolean) => void;
  readonly typed: string;
  readonly onType: (typed: string) => void;
  readonly fault: string | undefined;
}): ReactNode {
  return (
    <Disclosure
      open={props.open}
      onOpenChange={props.onOpen}
      label="Advanced"
      look={{ variant: "quiet", size: "sm" }}
      chevron
    >
      <div className="grid w-full gap-3">
        <RunnerHost host={props.host} onHost={props.onHost} />
        <RunnerCapabilities
          typed={props.typed}
          onType={props.onType}
          fault={props.fault}
        />
      </div>
    </Disclosure>
  );
}

function RunnerAskPresses(props: {
  readonly busy: boolean;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="primary"
        type="submit"
        busy={props.busy}
        disabled={props.busy}
      >
        Create token
      </Button>
      <Button size="sm" disabled={props.busy} onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** The line a refused mint leaves in its ask. */
export function runnerMintRefusal(failure: ApiFailure): string {
  return `Refused · ${panelReason(failure)}`;
}

/** A registration token's mint, from the press that opens its ask through
 * the token it answered, which stands with the ask it declares until closed. */
export interface RunnerMinting {
  readonly writing: ConsoleWriting<RunnerAsk, WorkerPoolTokenResponse>;
  /** Whether the ask or the steps are drawn. */
  readonly opened: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

export function useRunnerMinting(
  write: ConsoleWrite<RunnerAsk, WorkerPoolTokenResponse>,
  shown: ConsoleWriteShown<RunnerAsk>,
): RunnerMinting {
  const [asking, setAsking] = useState(false);
  const writing = useConsoleWrite(write, shown);
  return {
    writing,
    opened:
      asking ||
      writing.isPending ||
      writing.error !== null ||
      writing.isSuccess,
    open: () => {
      setAsking(true);
    },
    close: () => {
      setAsking(false);
      writing.reset();
    },
  };
}

/**
 * The ask, while it is filled in and while the caller mints its token, a
 * project's pool token or a member's own. It takes the focus as it is drawn
 * only where nothing holds it, as the steps do, since the press that opened it
 * can be gone from under it.
 */
function RunnerAskForm(props: { readonly minting: RunnerMinting }): ReactNode {
  const [chosen, setChosen] = useState<RunnerPackageName>("linux");
  const [host, setHost] = useState(false);
  const [typed, setTyped] = useState("");
  const [fault, setFault] = useState<string | undefined>(undefined);
  const [advanced, setAdvanced] = useState(false);
  const writing = props.minting.writing;
  const form = useFocusedUnheld<HTMLFormElement>();
  return (
    <form
      ref={form}
      tabIndex={-1}
      aria-label="Runner"
      className="border-edge grid min-w-0 justify-items-start gap-3 border-b pt-3 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const read = runnerAskRead(chosen, host, typed);
        if ("refused" in read) {
          setFault(read.refused);
          setAdvanced(true);
          return;
        }
        writing.mutate(read.ask);
      }}
    >
      <RunnerMachine chosen={chosen} onChoose={setChosen} />
      <RunnerAdvanced
        open={advanced}
        onOpen={setAdvanced}
        host={host}
        onHost={setHost}
        typed={typed}
        onType={(value) => {
          setTyped(value);
          setFault(undefined);
        }}
        fault={fault}
      />
      {writing.error === null ? null : (
        <Notice tone="danger" inline detail={writing.error.message} />
      )}
      <RunnerAskPresses
        busy={writing.isPending}
        onCancel={props.minting.close}
      />
    </form>
  );
}

/** The ask while the token is unminted, and once it is, the steps it is
 * handed over in, until `onDone` closes them. */
export function RunnerMintOpened(props: {
  readonly minting: RunnerMinting;
  readonly kind: RunnerKind;
  readonly onDone: () => void;
}): ReactNode {
  const { minting } = props;
  const { data: minted, variables: ask } = minting.writing;
  if (minted !== undefined && ask !== undefined)
    return (
      <RunnerSteps
        minted={minted}
        ask={ask}
        kind={props.kind}
        onDone={props.onDone}
      />
    );
  return minting.opened ? <RunnerAskForm minting={minting} /> : null;
}
