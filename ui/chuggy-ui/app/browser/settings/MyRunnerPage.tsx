/**
 * The reader's own runners in this workspace, as a list: a row each, saying
 * what it declared and runs and whether it is polling, and taking it off; the
 * projects every one of them takes work in; the command that registers one
 * more, where the workspace lets them and they hold fewer than a member may;
 * their chat host; and each agent of their own account a pause holds, which
 * none of their runners takes work for until it ends.
 *
 * A PROJECT IS OFFERED ONLY WHERE THE READER READS IT. The list it is chosen
 * from is the reader's own inventory narrowed to this workspace, which is the
 * read the API answers an allowlist addition by, so nothing is offered that the
 * server would refuse for that reason.
 *
 * A RUNNER THE READER HOLDS IS DRAWN WHETHER OR NOT THEY MAY REGISTER ONE NOW,
 * so a member whose permission was taken away can still see and remove theirs.
 * The ask and the steps a registration is handed over in stand through the
 * list's reads, whatever they answer, until the reader is done with them.
 */

import { Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  PersonalRunnerPermitResponse,
  PersonalRunnerResponse,
  WorkerPoolTokenResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { agentAccountsPaused } from "../../core/agentAccounts.ts";
import { accountAgentLabel } from "../../core/codeLabels.ts";
import type { ApiFailure, ApiResult } from "../../core/apiRequest.ts";
import {
  apiDeregisterPersonalRunner,
  apiMintPersonalRunnerToken,
  apiPersonalRunnerServes,
} from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../../core/consoleWrite.ts";
import { instantFigure } from "../../core/figures.ts";
import type { Copy } from "../../core/copy.ts";
import { failureWords } from "../../core/failureWords.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  myRunnerAddable,
  myRunnerRemovalLine,
  myRunnerRoom,
  myRunnersCountLine,
  myRunnerShort,
  myRunnerWithheld,
} from "../../core/myRunner.ts";
import {
  runnerCapabilityLabel,
  runnerStandingLabel,
  runnerTokenLifetimeSecs,
} from "../../core/runners.ts";
import type { RunnerAsk } from "../../core/runners.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  personalRunnerPermitQuery,
  projectsInventoryQuery,
} from "../../core/tenantQueries.ts";
import { runnerStandingTone } from "../../core/tones.ts";
import { AgentPause } from "../AgentPause.tsx";
import { useAgentAccounts } from "../agentAccounts.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { personalRunnerReread, usePersonalRunner } from "../personalRunner.ts";
import {
  RunnerMintOpened,
  runnerMintRefusal,
  useRunnerMinting,
} from "../RunnerAsk.tsx";
import type { RunnerMinting } from "../RunnerAsk.tsx";
import { RunnerVersion } from "../RunnerVersion.tsx";
import { HostListingHead, MyChatHost, useChatHost } from "./MyChatHost.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";
import { Pill } from "../ui/Pill.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import {
  SettingsListing,
  settingsListingNone,
  SettingsListingSection,
  SettingsListingTable,
  SettingsListingUnread,
  SettingsListingWithheld,
} from "./SettingsListing.tsx";

type PersonalRunnerListed = PersonalRunnerResponse["runners"][number];

/** A project the reader's runners take work in, or stop taking it in. */
interface MyRunnerServed {
  readonly project: string;
  readonly served: boolean;
}

/** The runners read again whatever a change answered, and a removal a 404
 * answers taken as done already. */
async function myRunnerWritten(
  client: QueryClient,
  tenant: string,
  sent: Promise<ApiResult<undefined>>,
  removal: boolean,
): Promise<ApiResult<undefined>> {
  const answered = await sent;
  await personalRunnerReread(client, tenant);
  return removal && answered.outcome === "Absent"
    ? { outcome: "Ok", value: undefined }
    : answered;
}

function myRunnerRefusal(failure: ApiFailure): Copy {
  return failureWords(failure).word;
}

function myRunnerRemovalWrite(tenant: string): ConsoleWrite<string, undefined> {
  return {
    mutationKey: consoleWriteKey("personal-runner-removal", tenant),
    write: (ports, runner, client) =>
      myRunnerWritten(
        client,
        tenant,
        apiDeregisterPersonalRunner(ports, tenant, runner),
        true,
      ),
    refusal: myRunnerRefusal,
  };
}

function myRunnerServesWrite(
  tenant: string,
): ConsoleWrite<MyRunnerServed, undefined> {
  return {
    mutationKey: consoleWriteKey("personal-runner-serves", tenant),
    write: (ports, served, client) =>
      myRunnerWritten(
        client,
        tenant,
        apiPersonalRunnerServes(
          ports,
          { tenant, project: served.project },
          served.served,
        ),
        false,
      ),
    refusal: myRunnerRefusal,
  };
}

function myRunnerTokenWrite(
  tenant: string,
): ConsoleWrite<RunnerAsk, WorkerPoolTokenResponse> {
  return {
    mutationKey: consoleWriteKey("personal-runner-token-mint", tenant),
    write: (ports) =>
      apiMintPersonalRunnerToken(ports, tenant, {
        lifetimeSecs: runnerTokenLifetimeSecs,
      }),
    refusal: runnerMintRefusal,
  };
}

/** One change at a time: a runner taken off or a project moved, each pressed
 * only while neither is under way, and the refusal of the last pressed. */
interface MyRunnerWriting {
  readonly removing: ConsoleWriting<string, undefined>;
  readonly serving: ConsoleWriting<MyRunnerServed, undefined>;
  readonly busy: boolean;
  readonly refused: ConsoleWriteRefused | undefined;
}

function useMyRunnerWriting(tenant: string): MyRunnerWriting {
  const removing = useConsoleWrite(myRunnerRemovalWrite(tenant), {
    drawn: true,
  });
  const serving = useConsoleWrite(myRunnerServesWrite(tenant), { drawn: true });
  return {
    removing,
    serving,
    busy: removing.isPending || serving.isPending,
    refused: removing.error ?? serving.error ?? undefined,
  };
}

/** Beside the list's count: the press that opens the ask a token is minted for, where the reader may register one more, and the line that says they may not where the bound is why. */
function MyRunnerRegister(props: {
  readonly granted: boolean;
  readonly room: boolean;
  readonly minting: RunnerMinting;
  /** Drawn as the one thing to do, which it is where the reader holds none. */
  readonly leading: boolean;
}): ReactNode {
  const text = useCopyText();
  if (!props.granted) return null;
  if (!props.room)
    return (
      <span className="text-sm text-ink-3">
        {text({ id: "runners-personal-limit" })}
      </span>
    );
  return (
    <Button
      size="sm"
      variant={props.leading ? "primary" : "default"}
      disabled={props.minting.opened}
      onClick={props.minting.open}
    >
      {text({ id: "runners-register" })}
    </Button>
  );
}

/** One runner's removal at a time, from its press through its question to its answer. */
interface MyRunnerRemoving {
  /** The runner whose removal is asked and not yet answered. */
  readonly asking: string | undefined;
  readonly busy: boolean;
  readonly press: (runner: string) => void;
  readonly cancel: () => void;
  readonly send: (runner: string) => void;
}

function useMyRunnerRemoving(
  held: PersonalRunnerResponse,
  writing: MyRunnerWriting,
): MyRunnerRemoving {
  const [asking, setAsking] = useState<string | undefined>(undefined);
  return {
    asking: held.runners.some((runner) => runner.id === asking)
      ? asking
      : undefined,
    busy: writing.busy,
    press: setAsking,
    cancel: () => {
      setAsking(undefined);
    },
    send: (runner) => {
      writing.serving.reset();
      writing.removing.mutate(runner, {
        onSettled: () => {
          setAsking(undefined);
        },
      });
    },
  };
}

const myRunnerColumnsCount = 6;

function MyRunnerRow(props: {
  readonly runner: PersonalRunnerListed;
  readonly removing: MyRunnerRemoving;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const { runner, removing, nowMs } = props;
  const short = myRunnerShort(runner.id);
  const standing = runner.live ? "Live" : "Offline";
  return (
    <tr>
      <th scope="row">
        <span className="people-name block font-strong text-ink-1">
          <span title={runner.id}>{short}</span>
        </span>
        <span className="block text-sm text-ink-3">
          {runner.capabilities.map(runnerCapabilityLabel).join(", ")}
        </span>
      </th>
      <td data-none={settingsListingNone(runner.runner === undefined)}>
        <span className="people-stacked-label">
          {text({ id: "runners-col-version" })}
        </span>
        <RunnerVersion runner={runner.runner} named />
      </td>
      <td>
        <span className="people-stacked-label">
          {text({ id: "runners-col-registered" })}
        </span>
        <Figure figure={instantFigure(runner.registeredAt, nowMs)} />
      </td>
      <td>
        <span className="people-stacked-label">
          {text({ id: "runners-col-last-polled" })}
        </span>
        {runner.polledAt === undefined ? (
          text({ id: "runners-never" })
        ) : (
          <Figure figure={instantFigure(runner.polledAt, nowMs)} />
        )}
      </td>
      <td>
        <Pill tone={runnerStandingTone(standing)}>
          {text(runnerStandingLabel(standing))}
        </Pill>
      </td>
      <td className="people-edit">
        <Button
          variant="quiet"
          size="sm"
          named={text({ id: "runners-personal-remove-named", args: { short } })}
          disabled={removing.busy || removing.asking !== undefined}
          onClick={() => {
            removing.press(runner.id);
          }}
        >
          {text({ id: "runners-remove" })}
        </Button>
      </td>
    </tr>
  );
}

/** Under a runner's row, the question its removal waits on. */
function MyRunnerAsked(props: {
  readonly runner: PersonalRunnerListed;
  readonly last: boolean;
  readonly removing: MyRunnerRemoving;
}): ReactNode {
  const text = useCopyText();
  const { runner, removing } = props;
  if (removing.asking !== runner.id) return null;
  const short = myRunnerShort(runner.id);
  return (
    <tr className="people-asked">
      <td colSpan={myRunnerColumnsCount}>
        <div className="ms-auto grid max-w-aside gap-2">
          <Confirm
            question={text({
              id: "runners-personal-remove-question",
              args: { short },
            })}
            confirm={text({ id: "runners-remove" })}
            busy={removing.busy}
            onConfirm={() => {
              removing.send(runner.id);
            }}
            onCancel={removing.cancel}
          >
            {text(myRunnerRemovalLine(short, props.last))}
          </Confirm>
        </div>
      </td>
    </tr>
  );
}

function MyRunnerRows(props: {
  readonly runner: PersonalRunnerListed;
  readonly last: boolean;
  readonly removing: MyRunnerRemoving;
  readonly nowMs: number;
}): ReactNode {
  return (
    <>
      <MyRunnerRow
        runner={props.runner}
        removing={props.removing}
        nowMs={props.nowMs}
      />
      <MyRunnerAsked
        runner={props.runner}
        last={props.last}
        removing={props.removing}
      />
    </>
  );
}

function MyRunnersTable(props: {
  readonly held: PersonalRunnerResponse;
  readonly removing: MyRunnerRemoving;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  const runners = props.held.runners;
  return (
    <SettingsListingTable caption={text({ id: "runners-title" })}>
      <HostListingHead name={text({ id: "runners-col-runner" })} />
      <tbody>
        {runners.map((runner) => (
          <MyRunnerRows
            key={runner.id}
            runner={runner}
            last={runners.length === 1}
            removing={props.removing}
            nowMs={nowMs}
          />
        ))}
      </tbody>
    </SettingsListingTable>
  );
}

/** What heads the list of projects: the menu of those the reader may add, where there are any. */
function MyRunnerProjectAdd(props: {
  readonly addable: readonly string[] | undefined;
  readonly onAdd: (project: string) => void;
}): ReactNode {
  const text = useCopyText();
  const addable = props.addable ?? [];
  if (addable.length === 0) return null;
  const add = text({ id: "runners-personal-project-add" });
  return (
    <Picker
      label={add}
      value=""
      placeholder={add}
      align="end"
      options={addable.map((project) => ({ value: project, text: project }))}
      onChoose={props.onAdd}
    />
  );
}

/** The projects every runner of the reader's takes work in, each with the
 * press that removes it. */
function MyRunnerProjectsTable(props: {
  readonly projects: readonly string[];
  readonly busy: boolean;
  readonly onRemove: (project: string) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <SettingsListingTable caption={text({ id: "runners-personal-projects" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "runners-personal-project-col" })}</th>
          <th scope="col" className="w-[8em]">
            <span className="visually-hidden">
              {text({ id: "runners-col-remove" })}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {props.projects.map((project) => (
          <tr key={project}>
            <th scope="row">
              <span className="people-name block text-ink-1">{project}</span>
            </th>
            <td className="people-edit">
              <Button
                variant="quiet"
                size="sm"
                named={text({
                  id: "runners-personal-project-remove",
                  args: { project },
                })}
                disabled={props.busy}
                onClick={() => {
                  props.onRemove(project);
                }}
              >
                {text({ id: "runners-remove" })}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </SettingsListingTable>
  );
}

/** The projects every runner of the reader's takes work in, each removable, and the ones they may be given. */
function MyRunnerProjects(props: {
  readonly held: PersonalRunnerResponse;
  readonly addable: readonly string[] | undefined;
  readonly writing: MyRunnerWriting;
}): ReactNode {
  const text = useCopyText();
  const { held, writing } = props;
  const busy = writing.busy;
  const serves = (project: string, served: boolean): void => {
    if (busy) return;
    writing.removing.reset();
    writing.serving.mutate({ project, served });
  };
  return (
    <SettingsListingSection
      heading={text({ id: "runners-personal-projects" })}
      about={text({ id: "runners-personal-projects-about" })}
      action={
        <MyRunnerProjectAdd
          addable={props.addable}
          onAdd={(project) => {
            serves(project, true);
          }}
        />
      }
    >
      {held.projects.length === 0 ? (
        <EmptyState label={text({ id: "runners-personal-projects-none" })} />
      ) : (
        <MyRunnerProjectsTable
          projects={held.projects}
          busy={busy}
          onRemove={(project) => {
            serves(project, false);
          }}
        />
      )}
    </SettingsListingSection>
  );
}

/** The runners the reader holds under the line `listed` heads them with, their projects, and what a refused change left. */
function MyRunnersHeld(props: {
  readonly tenant: string;
  readonly held: PersonalRunnerResponse;
  readonly addable: readonly string[] | undefined;
  readonly listed: (table: ReactNode) => ReactNode;
}): ReactNode {
  const writing = useMyRunnerWriting(props.tenant);
  const removing = useMyRunnerRemoving(props.held, writing);
  return (
    <>
      {props.listed(<MyRunnersTable held={props.held} removing={removing} />)}
      <MyRunnerProjects
        held={props.held}
        addable={props.addable}
        writing={writing}
      />
      {writing.refused === undefined ? null : (
        <Notice tone="danger" inline>
          <ConsoleWriteRefusedWords refused={writing.refused} />
        </Notice>
      )}
    </>
  );
}

/**
 * The list, or the one line that stands for it: the read's own while neither
 * it nor the permit is read, and why none may be registered where the reader
 * holds none and the workspace does not let them. The ask and the steps are
 * held here, above both, so a read that finds the runner they registered
 * leaves them standing.
 */
function MyRunners(props: {
  readonly tenant: string;
  readonly runner: PanelState<PersonalRunnerResponse>;
  readonly permit: PanelState<PersonalRunnerPermitResponse>;
  readonly addable: readonly string[] | undefined;
}): ReactNode {
  const text = useCopyText();
  const client = useQueryClient();
  const { runner, permit } = props;
  const withheld = text(myRunnerWithheld);
  const held = runner.state === "Ready" ? runner.value : undefined;
  const granted = permit.state === "Ready" && permit.value.granted;
  const minting = useRunnerMinting(myRunnerTokenWrite(props.tenant), {
    drawn: held !== undefined || (runner.state === "Absent" && granted),
  });
  if (held === undefined && runner.state !== "Absent")
    return <SettingsListingUnread state={runner} withheld={withheld} />;
  if (held === undefined && permit.state !== "Ready")
    return <SettingsListingUnread state={permit} withheld={withheld} />;
  if (held === undefined && !granted)
    return <SettingsListingWithheld line={withheld} />;
  const listed = (table: ReactNode): ReactNode => (
    <SettingsListingSection
      heading={text(myRunnersCountLine(held?.runners.length ?? 0))}
      about={text({ id: "runners-personal-about" })}
      action={
        <MyRunnerRegister
          granted={granted}
          room={myRunnerRoom(held)}
          minting={minting}
          leading={held === undefined}
        />
      }
    >
      <RunnerMintOpened
        minting={minting}
        kind="Personal"
        onDone={() => {
          minting.close();
          void personalRunnerReread(client, props.tenant);
        }}
      />
      {table}
    </SettingsListingSection>
  );
  return held === undefined ? (
    listed(null)
  ) : (
    <MyRunnersHeld
      tenant={props.tenant}
      held={held}
      addable={props.addable}
      listed={listed}
    />
  );
}

/** Where the reader's agent accounts are set, in the frame the page is drawn in. */
function MyRunnerUsageLink(props: { readonly tenant: string }): ReactNode {
  const text = useCopyText();
  const usage = text({ id: "runners-personal-usage" });
  const project = useParams({ strict: false }).project;
  return project === undefined ? (
    <Link to={settingsRoutes.workspace.usage} params={{ tenant: props.tenant }}>
      {usage}
    </Link>
  ) : (
    <Link
      to={settingsRoutes.project.usage}
      params={{ tenant: props.tenant, project }}
    >
      {usage}
    </Link>
  );
}

/** Each agent of the reader's own account a pause holds, and nothing where none does. */
function MyRunnerPauses(props: { readonly tenant: string }): ReactNode {
  const text = useCopyText();
  const accounts = useAgentAccounts();
  const nowMs = useNowMs();
  if (accounts.state !== "Ready") return null;
  const paused = agentAccountsPaused(accounts.value);
  if (paused.length === 0) return null;
  return (
    <div
      className="grid gap-1"
      aria-label={text({ id: "runners-personal-paused" })}
      role="group"
    >
      {paused.map((account) => (
        <AgentPause
          key={account.agent}
          pause={account.pause}
          nowMs={nowMs}
          named={text(accountAgentLabel(account.agent))}
        >
          {" · "}
          <MyRunnerUsageLink tenant={props.tenant} />
        </AgentPause>
      ))}
    </div>
  );
}

export function MyRunnerPage(): ReactNode {
  const text = useCopyText();
  const tenant = useSettingsTenant();
  const permit = usePanelState(personalRunnerPermitQuery(tenant));
  const runner = usePersonalRunner(tenant);
  const host = useChatHost(tenant);
  const inventory = usePanelState(projectsInventoryQuery());
  return (
    <SettingsPage title={text({ id: "runners-personal-title" })}>
      <SettingsListing>
        <MyRunnerPauses tenant={tenant} />
        <MyRunners
          tenant={tenant}
          runner={runner}
          permit={permit}
          addable={
            inventory.state === "Ready" && runner.state === "Ready"
              ? myRunnerAddable(inventory.value, tenant, runner.value)
              : undefined
          }
        />
        <MyChatHost
          tenant={tenant}
          host={host}
          granted={permit.state === "Ready" && permit.value.granted}
        />
      </SettingsListing>
    </SettingsPage>
  );
}
