/**
 * The reader's own runner in this workspace: the command that registers it,
 * where the workspace lets them; what it declared and whether it is polling;
 * the projects it takes work in; and taking it off.
 *
 * A PROJECT IS OFFERED ONLY WHERE THE READER READS IT. The list it is chosen
 * from is the reader's own inventory narrowed to this workspace, which is the
 * read the API answers an allowlist addition by, so nothing is offered that the
 * server would refuse for that reason.
 *
 * A RUNNER THE READER HOLDS IS DRAWN WHETHER OR NOT THEY MAY REGISTER ONE NOW,
 * so a member whose permission was taken away can still see and remove theirs.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  PersonalRunnerPermitResponse,
  PersonalRunnerResponse,
  WorkerPoolTokenResponse,
} from "../../../../../src/contract/responses.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import {
  apiDeregisterPersonalRunner,
  apiMintPersonalRunnerToken,
  apiPersonalRunnerPermit,
  apiPersonalRunnerServes,
  apiProjectInventoryAll,
} from "../../core/apiRoutes.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { panelReason } from "../../core/freshness.ts";
import { myRunnerAddable, myRunnerWithheld } from "../../core/myRunner.ts";
import {
  runnerCapabilityLabel,
  runnerPlatforms,
  runnerStandingLabel,
  runnerTokenLifetimeSecs,
} from "../../core/runners.ts";
import {
  useApiPorts,
  usePanelInventory,
  usePanelTenantResource,
} from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import {
  personalRunnerForgotten,
  personalRunnerReread,
  usePersonalRunner,
} from "../personalRunner.ts";
import { RunnerCommand } from "../RunnerCommand.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Picker } from "../ui/Picker.tsx";
import { Table } from "../ui/Table.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";

/** No frame names this read, so a fresh visit is what reaches it. */
const personalRunnerPermitResource = "personal-runner-permit";

type MyRunnerMint =
  | { readonly mint: "Idle" }
  | { readonly mint: "Minting" }
  | { readonly mint: "Minted"; readonly minted: WorkerPoolTokenResponse }
  | { readonly mint: "Failed"; readonly reason: string };

/** Where a change to the runner got to: sent, or refused with why. */
type MyRunnerWrite =
  | { readonly write: "Idle" }
  | { readonly write: "Writing" }
  | { readonly write: "Failed"; readonly reason: string };

interface MyRunnerWriting {
  readonly write: MyRunnerWrite;
  /** `removes` where the change takes the runner off, so it is read with nothing held. */
  readonly send: (
    sent: Promise<ApiResult<undefined>>,
    removes?: boolean,
  ) => void;
}

/** One change at a time, the runner read again once it has landed. */
function useMyRunnerWriting(tenant: string): MyRunnerWriting {
  const client = useQueryClient();
  const [write, setWrite] = useState<MyRunnerWrite>({ write: "Idle" });
  return {
    write,
    send: (sent, removes = false) => {
      setWrite({ write: "Writing" });
      void (async () => {
        const answered = await sent;
        if (removes && answered.outcome === "Ok")
          await personalRunnerForgotten(client, tenant);
        else await personalRunnerReread(client, tenant);
        setWrite(
          answered.outcome === "Ok"
            ? { write: "Idle" }
            : { write: "Failed", reason: panelReason(answered) },
        );
      })();
    },
  };
}

/** The press that mints a token, and the command it is handed over in. */
function MyRunnerRegister(props: { readonly tenant: string }): ReactNode {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [mint, setMint] = useState<MyRunnerMint>({ mint: "Idle" });
  if (mint.mint === "Minted")
    return (
      <RunnerCommand
        minted={mint.minted}
        kind="Personal"
        onDone={() => {
          setMint({ mint: "Idle" });
          void personalRunnerReread(client, props.tenant);
        }}
      />
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EmptyState label="No runner registered" />
      <Button
        size="sm"
        busy={mint.mint === "Minting"}
        disabled={mint.mint === "Minting"}
        onClick={() => {
          setMint({ mint: "Minting" });
          void (async () => {
            const minted = await apiMintPersonalRunnerToken(
              ports,
              props.tenant,
              {
                capabilities: [...runnerPlatforms],
                lifetimeSecs: runnerTokenLifetimeSecs,
              },
            );
            setMint(
              minted.outcome === "Ok"
                ? { mint: "Minted", minted: minted.value }
                : { mint: "Failed", reason: panelReason(minted) },
            );
          })();
        }}
      >
        Register runner
      </Button>
      {mint.mint === "Failed" ? (
        <Notice tone="danger" inline detail={`Refused · ${mint.reason}`} />
      ) : null}
    </div>
  );
}

function MyRunnerDetails(props: {
  readonly runner: PersonalRunnerResponse;
}): ReactNode {
  const nowMs = useNowMs();
  const runner = props.runner;
  return (
    <Table caption="Your runner">
      <thead>
        <tr>
          <th scope="col">Platforms</th>
          <th scope="col">Registered</th>
          <th scope="col">Last polled</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{runner.capabilities.map(runnerCapabilityLabel).join(", ")}</td>
          <td>
            <Figure figure={instantFigure(runner.registeredAt, nowMs)} />
          </td>
          <td>
            {runner.polledAt === undefined ? (
              "Never"
            ) : (
              <Figure figure={instantFigure(runner.polledAt, nowMs)} />
            )}
          </td>
          <td>{runnerStandingLabel(runner.live ? "Live" : "Offline")}</td>
        </tr>
      </tbody>
    </Table>
  );
}

/** The projects the runner takes work in, each removable, and the ones it may be given. */
function MyRunnerProjects(props: {
  readonly tenant: string;
  readonly runner: PersonalRunnerResponse;
  readonly addable: readonly string[] | undefined;
  readonly writing: MyRunnerWriting;
}): ReactNode {
  const ports = useApiPorts();
  const { tenant, runner, writing } = props;
  const busy = writing.write.write === "Writing";
  const serves = (project: string, served: boolean): void => {
    writing.send(apiPersonalRunnerServes(ports, { tenant, project }, served));
  };
  return (
    <div className="grid gap-2">
      <span className="text-sm text-ink-3">Takes work in</span>
      {runner.projects.length === 0 ? (
        <EmptyState label="No project yet" />
      ) : (
        <ul className="grid gap-1" aria-label="Projects">
          {runner.projects.map((project) => (
            <li key={project} className="flex items-center gap-2">
              <span className="grow">{project}</span>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => {
                  serves(project, false);
                }}
              >
                {`Remove ${project}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {props.addable === undefined || props.addable.length === 0 ? null : (
        <div>
          <Picker
            label="Add a project"
            value=""
            placeholder="Add a project"
            options={props.addable.map((project) => ({
              value: project,
              text: project,
            }))}
            onChoose={(project) => {
              if (!busy) serves(project, true);
            }}
          />
        </div>
      )}
    </div>
  );
}

function MyRunnerRemove(props: {
  readonly tenant: string;
  readonly writing: MyRunnerWriting;
}): ReactNode {
  const ports = useApiPorts();
  const [asking, setAsking] = useState(false);
  const busy = props.writing.write.write === "Writing";
  if (!asking)
    return (
      <div>
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => {
            setAsking(true);
          }}
        >
          Remove runner
        </Button>
      </div>
    );
  return (
    <Confirm
      question="Remove your runner?"
      confirm="Remove"
      busy={busy}
      onConfirm={() => {
        props.writing.send(
          apiDeregisterPersonalRunner(ports, props.tenant),
          true,
        );
      }}
      onCancel={() => {
        setAsking(false);
      }}
    >
      It stops taking work in this workspace, and what it holds is given back.
    </Confirm>
  );
}

function MyRunnerHeld(props: {
  readonly tenant: string;
  readonly runner: PersonalRunnerResponse;
  readonly addable: readonly string[] | undefined;
}): ReactNode {
  const writing = useMyRunnerWriting(props.tenant);
  return (
    <div className="grid gap-4">
      <MyRunnerDetails runner={props.runner} />
      <MyRunnerProjects
        tenant={props.tenant}
        runner={props.runner}
        addable={props.addable}
        writing={writing}
      />
      <MyRunnerRemove tenant={props.tenant} writing={writing} />
      {writing.write.write === "Failed" ? (
        <Notice
          tone="danger"
          inline
          detail={`Refused · ${writing.write.reason}`}
        />
      ) : null}
    </div>
  );
}

function MyRunnerBody(props: {
  readonly tenant: string;
  readonly runner: PanelState<PersonalRunnerResponse>;
  readonly permit: PanelState<PersonalRunnerPermitResponse>;
  readonly addable: readonly string[] | undefined;
}): ReactNode {
  const { runner, permit } = props;
  if (runner.state === "Ready")
    return (
      <MyRunnerHeld
        tenant={props.tenant}
        runner={runner.value}
        addable={props.addable}
      />
    );
  if (runner.state !== "Absent") return <PanelUnready state={runner} />;
  if (permit.state !== "Ready") return <PanelUnready state={permit} />;
  return permit.value.granted ? (
    <MyRunnerRegister tenant={props.tenant} />
  ) : (
    <Notice tone="parked" inline detail={myRunnerWithheld} />
  );
}

export function MyRunnerPage(): ReactNode {
  const tenant = useSettingsTenant();
  const permit = usePanelTenantResource(
    tenant,
    personalRunnerPermitResource,
    (ports) => apiPersonalRunnerPermit(ports, tenant),
  );
  const runner = usePersonalRunner(tenant);
  const inventory = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  return (
    <SettingsPage title="My runner">
      <Panel
        variant="section"
        title="My runner"
        about="A machine of yours that runs the work you start in this workspace."
      >
        <MyRunnerBody
          tenant={tenant}
          runner={runner}
          permit={permit}
          addable={
            inventory.state === "Ready" && runner.state === "Ready"
              ? myRunnerAddable(inventory.value, tenant, runner.value)
              : undefined
          }
        />
      </Panel>
    </SettingsPage>
  );
}
