/**
 * The reader's own agent accounts, which are theirs in every workspace: for
 * each agent, each window's newest reading and the share it pauses at, and
 * whether their threads pause with it, edited behind one Edit; and the pause
 * holding it, with the press that tries it once past a provider's limit.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AgentAccount,
  AgentPause as AgentPauseValue,
} from "../../../../../src/contract/responses.ts";
import type { AccountAgent } from "../../../../../src/contract/rosters.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  agentAccountDraftOf,
  agentAccountDraftRead,
  agentAccountDraftSame,
  agentAccountPercentFault,
  agentAccountPercentWindows,
  agentAccountPressRefusal,
  agentAccountReading,
  agentAccountReadingStale,
  agentAccountReadingStaleLine,
  agentAccountReadingStaleWord,
  agentPausePressable,
  agentPausePressedLine,
  runUsageWindowLabel,
} from "../../core/agentAccounts.ts";
import type {
  AgentAccountDraft,
  AgentAccountPercentName,
  AgentAccountSettings,
} from "../../core/agentAccounts.ts";
import {
  apiPressAgentAccount,
  apiWriteAgentAccountSettings,
} from "../../core/apiRoutes.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { Copy } from "../../core/copy.ts";
import { failureWords } from "../../core/failureWords.ts";
import { agoFigure, countFigure, shareFigure } from "../../core/figures.ts";
import { AgentPause } from "../AgentPause.tsx";
import { agentAccountsReread, useAgentAccounts } from "../agentAccounts.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Input } from "../ui/Input.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

/** The accounts read again whatever a write answered, since a press or a
 * threshold moves the pause the read answers. */
async function usageSettingsWritten(
  client: QueryClient,
  sent: Promise<ApiResult<undefined>>,
): Promise<ApiResult<undefined>> {
  const answered = await sent;
  await agentAccountsReread(client);
  return answered;
}

function usageSettingsWrite(
  agent: AccountAgent,
): ConsoleWrite<AgentAccountSettings, undefined> {
  return {
    mutationKey: consoleWriteKey("agent-account-settings", agent),
    write: (ports, settings, client) =>
      usageSettingsWritten(
        client,
        apiWriteAgentAccountSettings(ports, agent, settings),
      ),
    refusal: (failure) => failureWords(failure).word,
  };
}

function usageSettingsPressWrite(
  agent: AccountAgent,
): ConsoleWrite<undefined, undefined> {
  return {
    mutationKey: consoleWriteKey("agent-account-press", agent),
    write: (ports, _pressed, client) =>
      usageSettingsWritten(client, apiPressAgentAccount(ports, agent)),
    refusal: agentAccountPressRefusal,
  };
}

/** The write's line: under way, landed, or refused in the write's own words. */
function UsageSettingsNotice(props: {
  readonly writing: ConsoleWriting<AgentAccountSettings, undefined>;
}): ReactNode {
  const text = useCopyText();
  const writing = props.writing;
  if (writing.isPending)
    return <Notice tone="info" inline detail={text({ id: "usage-writing" })} />;
  if (writing.error === null)
    return writing.isSuccess ? (
      <Notice tone="live" inline detail={text({ id: "usage-written" })} />
    ) : null;
  return (
    <Notice tone="danger" inline>
      <ConsoleWriteRefusedWords refused={writing.error} />
    </Notice>
  );
}

/** The pause holding the agent, and the press that tries it once past a limit
 * where no press is already waiting to. */
function UsageSettingsPause(props: {
  readonly agent: AccountAgent;
  readonly pause: AgentPauseValue;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const pressing = useConsoleWrite(usageSettingsPressWrite(props.agent), {
    drawn: true,
  });
  const pressable = agentPausePressable(props.pause);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AgentPause pause={props.pause} nowMs={props.nowMs}>
          {props.pause.pressed ? ` · ${text(agentPausePressedLine)}` : null}
        </AgentPause>
        {pressable ? (
          <Button
            size="sm"
            busy={pressing.isPending}
            disabled={pressing.isPending}
            named={text({
              id: "usage-try-again-named",
              args: { agent: props.agent },
            })}
            onClick={() => {
              pressing.mutate(undefined);
            }}
          >
            {text({ id: "usage-try-again" })}
          </Button>
        ) : null}
      </div>
      {pressing.error === null ? null : (
        <Notice tone="danger" inline>
          <ConsoleWriteRefusedWords refused={pressing.error} />
        </Notice>
      )}
    </div>
  );
}

/** One window's newest reading: its share, how long ago it was read, and a
 * mark where its window has reset since. */
function UsageSettingsReading(props: {
  readonly account: AgentAccount;
  readonly name: AgentAccountPercentName;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const reading = agentAccountReading(
    props.account,
    agentAccountPercentWindows[props.name],
  );
  if (reading === undefined)
    return <span>{text({ id: "usage-no-reading" })}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Figure figure={shareFigure(reading.utilization)} />
      <span className="text-ink-3">
        {"· "}
        <Figure figure={agoFigure(reading.observedAt, props.nowMs)} />
      </span>
      {agentAccountReadingStale(reading, props.nowMs) ? (
        <Tooltip text={agentAccountReadingStaleLine}>
          <span>
            <Pill tone="parked">{text(agentAccountReadingStaleWord)}</Pill>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** Each window's reading and the share it pauses at, and both options, as read. */
function UsageSettingsRead(props: {
  readonly account: AgentAccount;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const settings = props.account.settings;
  const options = (pauses: boolean): Copy =>
    pauses
      ? { id: "usage-threads-pause-with" }
      : { id: "usage-threads-keep-running" };
  return (
    <Fields>
      {usageSettingsPercentNames.map((name) => (
        <Field key={name} name={text(usageSettingsPercentLabel(name))}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <UsageSettingsReading
              account={props.account}
              name={name}
              nowMs={props.nowMs}
            />
            <span className="text-ink-3">
              {`· ${text({ id: "usage-pauses-at" })} `}
              <Figure
                figure={countFigure(settings[name], {
                  id: "figures-unit-percent",
                })}
              />
            </span>
          </span>
        </Field>
      ))}
      <Field name={text(usageSettingsThreadsLabel)}>
        {text(options(settings.pausesThreads))}
      </Field>
    </Fields>
  );
}

const usageSettingsPercentNames: readonly AgentAccountPercentName[] = [
  "fiveHourPercent",
  "sevenDayPercent",
];

function usageSettingsPercentLabel(name: AgentAccountPercentName): Copy {
  return runUsageWindowLabel(agentAccountPercentWindows[name]);
}

const usageSettingsThreadsLabel: Copy = { id: "usage-threads" };

/** Each window's threshold as typed, marked where the wire would refuse it,
 * and the threads option. */
function UsageSettingsEditing(props: {
  readonly draft: AgentAccountDraft;
  readonly onDraft: (draft: AgentAccountDraft) => void;
}): ReactNode {
  const text = useCopyText();
  const draft = props.draft;
  const faults = agentAccountDraftRead(draft).faults;
  return (
    <div className="grid gap-3">
      {usageSettingsPercentNames.map((name) => (
        <label key={name} className="grid gap-1">
          <span className="text-sm text-ink-3">
            {text({
              id: "usage-window-pauses-at",
              args: { window: usageSettingsPercentLabel(name) },
            })}
          </span>
          <Input
            numeric
            label={text(usageSettingsPercentLabel(name))}
            unit="%"
            value={draft[name]}
            invalid={faults?.has(name) === true}
            onChange={(typed) => {
              props.onDraft({ ...draft, [name]: typed });
            }}
          />
          {faults?.has(name) === true ? (
            <span className="text-sm text-tone-fail">
              {text(agentAccountPercentFault)}
            </span>
          ) : null}
        </label>
      ))}
      <Checkbox
        label={text({ id: "usage-threads-pause" })}
        checked={draft.pausesThreads}
        onChange={(pausesThreads) => {
          props.onDraft({ ...draft, pausesThreads });
        }}
      />
    </div>
  );
}

function UsageSettingsAgent(props: {
  readonly account: AgentAccount;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const { account, nowMs } = props;
  const [draft, setDraft] = useState<AgentAccountDraft | undefined>(undefined);
  const saving = useConsoleWrite(usageSettingsWrite(account.agent), {
    drawn: true,
  });
  const shown = saving.isPending || saving.error !== null || saving.isSuccess;
  const read = draft === undefined ? undefined : agentAccountDraftRead(draft);
  return (
    <SettingsSection
      title={account.agent}
      about={text({ id: "usage-agent-about" })}
      editing={draft !== undefined}
      editable
      savable={!saving.isPending && read?.settings !== undefined}
      footLead={null}
      {...(shown ? { notice: <UsageSettingsNotice writing={saving} /> } : {})}
      onEdit={() => {
        saving.reset();
        setDraft(agentAccountDraftOf(account.settings));
      }}
      onCancel={() => {
        setDraft(undefined);
      }}
      onSave={() => {
        const settings = read?.settings;
        if (draft === undefined || settings === undefined) return;
        if (agentAccountDraftSame(draft, account.settings)) setDraft(undefined);
        else
          saving.mutate(settings, {
            onSuccess: () => {
              setDraft(undefined);
            },
          });
      }}
    >
      {account.pause === undefined ? null : (
        <UsageSettingsPause
          agent={account.agent}
          pause={account.pause}
          nowMs={nowMs}
        />
      )}
      {draft === undefined ? (
        <UsageSettingsRead account={account} nowMs={nowMs} />
      ) : (
        <UsageSettingsEditing draft={draft} onDraft={setDraft} />
      )}
    </SettingsSection>
  );
}

export function UsageSettingsPage(): ReactNode {
  const text = useCopyText();
  const accounts = useAgentAccounts();
  const nowMs = useNowMs();
  return (
    <SettingsPage title={text({ id: "usage-title" })}>
      <p className="text-sm text-ink-3">{text({ id: "usage-about" })}</p>
      {accounts.state === "Ready" ? (
        accounts.value.accounts.map((account) => (
          <UsageSettingsAgent
            key={account.agent}
            account={account}
            nowMs={nowMs}
          />
        ))
      ) : (
        <PanelUnready state={accounts} />
      )}
    </SettingsPage>
  );
}
