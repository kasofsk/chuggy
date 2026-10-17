/**
 * What a registration token is minted for, asked before it is: the package
 * the machine runs, whether a Mac runs work on itself, and the capabilities
 * the runner declares it meets. A mint is refused here before it is sent where
 * what was typed is not a capability, and a refused mint returns to the ask.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { WorkerPoolTokenResponse } from "../../../../src/contract/responses.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { panelReason } from "../core/freshness.ts";
import { runnerAskRead, runnerPackages } from "../core/runners.ts";
import type { RunnerMint, RunnerPackageName } from "../core/runners.ts";
import { Button } from "./ui/Button.tsx";
import { Checkbox } from "./ui/Checkbox.tsx";
import { Input } from "./ui/Input.tsx";
import { useFocusedUnheld } from "./RunnerSteps.tsx";
import { Notice } from "./ui/Notice.tsx";
import { ToggleGroup } from "./ui/ToggleGroup.tsx";

const runnerPackageNames = Object.keys(runnerPackages) as RunnerPackageName[];

/** The machine a runner is made of, and on a Mac whether it runs work on itself. */
function RunnerMachine(props: {
  readonly chosen: RunnerPackageName;
  readonly onChoose: (chosen: RunnerPackageName) => void;
  readonly host: boolean;
  readonly onHost: (host: boolean) => void;
}): ReactNode {
  const offered = runnerPackages[props.chosen];
  return (
    <>
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
      {offered.hostPlatforms.length > 0 ? (
        <div className="grid gap-1">
          <Checkbox
            label="Run work that pins no image on the Mac itself"
            checked={props.host}
            onChange={props.onHost}
          />
          <span className="text-xs font-regular">
            Nothing isolates that work from your account on the Mac.
          </span>
        </div>
      ) : null}
    </>
  );
}

function RunnerCapabilities(props: {
  readonly typed: string;
  readonly onType: (typed: string) => void;
  readonly fault: string | undefined;
}): ReactNode {
  const faultId = useId();
  return (
    <div className="grid w-full max-w-md gap-1">
      <Input
        label="Capabilities"
        value={props.typed}
        placeholder="Agent:Claude Tool:Bazel"
        onChange={props.onType}
        invalid={props.fault !== undefined}
        describedBy={faultId}
      />
      <span
        id={faultId}
        className={`text-xs ${props.fault === undefined ? "font-regular" : "text-tone-fail"}`}
      >
        {props.fault ??
          "What the runner declares it meets beside its platforms, as tasks require them. Optional."}
      </span>
    </div>
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

/**
 * The ask, while it is filled in and while its token is minted. The mint is
 * the caller's, a project's pool token or a member's own. It takes the focus
 * as it is drawn only where nothing holds it, as the steps do, since the press
 * that opened it can be gone from under it.
 */
export function RunnerAskForm(props: {
  readonly mint: Extract<RunnerMint, { readonly mint: "Asking" | "Minting" }>;
  readonly onMint: (mint: RunnerMint) => void;
  readonly minted: (
    capabilities: readonly string[],
  ) => Promise<ApiResult<WorkerPoolTokenResponse>>;
}): ReactNode {
  const [chosen, setChosen] = useState<RunnerPackageName>("linux");
  const [host, setHost] = useState(false);
  const [typed, setTyped] = useState("");
  const [fault, setFault] = useState<string | undefined>(undefined);
  const busy = props.mint.mint === "Minting";
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
          return;
        }
        props.onMint({ mint: "Minting" });
        void (async () => {
          const minted = await props.minted(read.capabilities);
          props.onMint(
            minted.outcome === "Ok"
              ? { mint: "Minted", minted: minted.value, ask: read.ask }
              : { mint: "Asking", reason: panelReason(minted) },
          );
        })();
      }}
    >
      <RunnerMachine
        chosen={chosen}
        onChoose={setChosen}
        host={host}
        onHost={setHost}
      />
      <RunnerCapabilities
        typed={typed}
        onType={(value) => {
          setTyped(value);
          setFault(undefined);
        }}
        fault={fault}
      />
      {props.mint.mint === "Asking" && props.mint.reason !== undefined ? (
        <Notice
          tone="danger"
          inline
          detail={`Refused · ${props.mint.reason}`}
        />
      ) : null}
      <RunnerAskPresses
        busy={busy}
        onCancel={() => {
          props.onMint({ mint: "Idle" });
        }}
      />
    </form>
  );
}
