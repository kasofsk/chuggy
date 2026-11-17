/**
 * The reader's own agent accounts, which are theirs in every workspace: for
 * each agent, each window's newest reading and the share it pauses at, and
 * whether their threads pause with it, edited behind one Edit; and the pause
 * holding it, named by the credentials holding it, with the press that tries
 * it once past a provider's limit. An agent holding several credentials, or
 * any turned off, reads each current one's reading under its name instead,
 * and the pause of each one on holding the agent's, and its press stays one,
 * with each of those credentials marked Off where it is, turned off once its
 * reader confirms it and on at a press, and retired from the account once its
 * reader confirms it.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AgentAccount,
  AgentAccountCredential,
  AgentPause as AgentPauseValue,
} from "../../../../../src/contract/responses.ts";
import type { AccountAgent } from "../../../../../src/contract/rosters.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  agentAccountCredentialOff,
  agentAccountCredentialOffWord,
  agentAccountCredentialsDrawn,
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
  agentAccountRetireRefusal,
  agentAccountTurnOffRefusal,
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
  apiRetireAgentAccountCredential,
  apiTurnOffAgentAccountCredential,
  apiTurnOnAgentAccountCredential,
  apiWriteAgentAccountSettings,
} from "../../core/apiRoutes.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import { accountAgentLabel } from "../../core/codeLabels.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { Copy } from "../../core/copy.ts";
import { failureWords } from "../../core/failureWords.ts";
import { agoFigure, countFigure, shareFigure } from "../../core/figures.ts";
import { AgentPause } from "../AgentPause.tsx";
import { LinePart } from "../ui/LinePart.tsx";
import { agentAccountsReread, useAgentAccounts } from "../agentAccounts.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Confirm } from "../ui/Confirm.tsx";
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

function usageSettingsRetireWrite(
  agent: AccountAgent,
  credential: string,
): ConsoleWrite<undefined, undefined> {
  return {
    mutationKey: consoleWriteKey("agent-account-retire", agent, credential),
    write: (ports, _retired, client) =>
      usageSettingsWritten(
        client,
        apiRetireAgentAccountCredential(ports, agent, credential),
      ),
    refusal: agentAccountRetireRefusal,
  };
}

/** A credential turned off where the write is sent `true`, and on where `false`. */
function usageSettingsTurnWrite(
  agent: AccountAgent,
  credential: string,
): ConsoleWrite<boolean, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "agent-account-credential-off",
      agent,
      credential,
    ),
    write: (ports, off, client) =>
      usageSettingsWritten(
        client,
        off
          ? apiTurnOffAgentAccountCredential(ports, agent, credential)
          : apiTurnOnAgentAccountCredential(ports, agent, credential),
      ),
    refusal: agentAccountTurnOffRefusal,
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

/** One pause as its line, named where it is a credential's, saying which
 * credentials hold it where it is the agent's and the read names them, and
 * saying so where a press lets one claim through it. */
function UsageSettingsPauseLine(props: {
  readonly pause: AgentPauseValue;
  readonly nowMs: number;
  readonly named?: string;
  readonly heldBy?: readonly string[];
}): ReactNode {
  const text = useCopyText();
  return (
    <AgentPause
      pause={props.pause}
      nowMs={props.nowMs}
      {...(props.named === undefined ? {} : { named: props.named })}
    >
      {props.heldBy === undefined ? null : (
        <LinePart>
          {text({
            id: "usage-held-by",
            args: { credentials: props.heldBy.join(", ") },
          })}
        </LinePart>
      )}
      {props.pause.pressed ? (
        <LinePart>{text(agentPausePressedLine)}</LinePart>
      ) : null}
    </AgentPause>
  );
}

/** The pause holding the agent, or each one holding a credential that is on
 * it is drawn by among those the agent's pause names where it names them, and
 * the press that tries the agent once past a limit where no press is already
 * waiting to. A pause that is `off` alone is the agent's line once, naming no
 * credential, since each one off is marked so on its own row. */
function UsageSettingsPause(props: {
  readonly agent: AccountAgent;
  readonly pause: NonNullable<AgentAccount["pause"]>;
  readonly credentials: readonly AgentAccountCredential[] | undefined;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const pressing = useConsoleWrite(usageSettingsPressWrite(props.agent), {
    drawn: true,
  });
  const pressable = agentPausePressable(props.pause);
  const off = props.pause.off === true;
  const holding = off ? undefined : props.pause.credentials;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {props.credentials === undefined || off ? (
          <UsageSettingsPauseLine
            pause={props.pause}
            nowMs={props.nowMs}
            {...(holding === undefined ? {} : { heldBy: holding })}
          />
        ) : (
          <div className="grid justify-items-start gap-1">
            {props.credentials.map((credential) =>
              credential.pause === undefined ||
              agentAccountCredentialOff(credential) ||
              holding?.includes(credential.name) === false ? null : (
                <UsageSettingsPauseLine
                  key={credential.name}
                  pause={credential.pause}
                  nowMs={props.nowMs}
                  named={credential.name}
                />
              ),
            )}
          </div>
        )}
        {pressable ? (
          <Button
            size="sm"
            busy={pressing.isPending}
            disabled={pressing.isPending}
            named={text({
              id: "usage-try-again-named",
              args: { agent: accountAgentLabel(props.agent) },
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

/** One window's reading of the agent or of one credential: its share, how
 * long ago it was read, and a mark where its window has reset since. */
function UsageSettingsReading(props: {
  readonly held: Pick<AgentAccount, "readings">;
  readonly name: AgentAccountPercentName;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const reading = agentAccountReading(
    props.held,
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
        <Tooltip trigger="abbreviation" text={agentAccountReadingStaleLine}>
          <span>
            <Pill tone="parked">{text(agentAccountReadingStaleWord)}</Pill>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** One window's reading of each credential the agent is drawn by, under its
 * name, or the agent's own where it is drawn by none. */
function UsageSettingsReadings(props: {
  readonly account: AgentAccount;
  readonly credentials: readonly AgentAccountCredential[] | undefined;
  readonly name: AgentAccountPercentName;
  readonly nowMs: number;
}): ReactNode {
  if (props.credentials === undefined || props.credentials.length === 0)
    return (
      <UsageSettingsReading
        held={
          props.credentials === undefined ? props.account : { readings: [] }
        }
        name={props.name}
        nowMs={props.nowMs}
      />
    );
  return (
    <span className="grid gap-1">
      {props.credentials.map((credential) => (
        <span
          key={credential.name}
          className="inline-flex flex-wrap items-center gap-2"
        >
          <span className="font-medium">{credential.name}</span>
          <UsageSettingsReading
            held={credential}
            name={props.name}
            nowMs={props.nowMs}
          />
        </span>
      ))}
    </span>
  );
}

/** What a credential's press asks before it writes: retiring it, or turning it off. */
type UsageSettingsAsking = "Retire" | "TurnOff";

interface UsageSettingsAskedCopy {
  readonly question: Copy;
  readonly confirm: Copy;
  readonly detail: Copy;
}

function usageSettingsAskedCopy(
  asking: UsageSettingsAsking,
  credential: string,
): UsageSettingsAskedCopy {
  const args = { credential };
  switch (asking) {
    case "Retire":
      return {
        question: { id: "usage-retire-question", args },
        confirm: { id: "usage-retire" },
        detail: { id: "usage-retirement", args },
      };
    case "TurnOff":
      return {
        question: { id: "usage-turn-off-question", args },
        confirm: { id: "usage-turn-off" },
        detail: { id: "usage-turned-off" },
      };
  }
}

/** A credential's presses: Turn on where it is off, else Turn off, and Retire
 * where it is on or lists a reading, since a limit alone is hidden behind its
 * `off` pause. */
function UsageSettingsCredentialPresses(props: {
  readonly credential: AgentAccountCredential;
  readonly turning: boolean;
  readonly retiring: boolean;
  readonly onAsk: (asking: UsageSettingsAsking) => void;
  readonly onTurnOn: () => void;
}): ReactNode {
  const text = useCopyText();
  const off = agentAccountCredentialOff(props.credential);
  const named = { credential: props.credential.name };
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="quiet"
        busy={props.turning}
        disabled={props.turning}
        named={text({
          id: off ? "usage-turn-on-named" : "usage-turn-off-named",
          args: named,
        })}
        onClick={() => {
          if (off) props.onTurnOn();
          else props.onAsk("TurnOff");
        }}
      >
        {text({ id: off ? "usage-turn-on" : "usage-turn-off" })}
      </Button>
      {off && props.credential.readings.length === 0 ? null : (
        <Button
          size="sm"
          variant="quiet"
          busy={props.retiring}
          disabled={props.retiring}
          named={text({ id: "usage-retire-named", args: named })}
          onClick={() => {
            props.onAsk("Retire");
          }}
        >
          {text({ id: "usage-retire" })}
        </Button>
      )}
    </span>
  );
}

/** What a credential's press asked, confirmed or cancelled. */
function UsageSettingsCredentialAsked(props: {
  readonly asking: UsageSettingsAsking;
  readonly credential: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const text = useCopyText();
  const asked = usageSettingsAskedCopy(props.asking, props.credential);
  return (
    <Confirm
      question={text(asked.question)}
      confirm={text(asked.confirm)}
      busy={false}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      {text(asked.detail)}
    </Confirm>
  );
}

/** One credential the agent is drawn by, under its name and marked Off where
 * it is, and its presses, each of which asks first but Turn on. */
function UsageSettingsCredential(props: {
  readonly agent: AccountAgent;
  readonly credential: AgentAccountCredential;
}): ReactNode {
  const text = useCopyText();
  const name = props.credential.name;
  const [asking, setAsking] = useState<UsageSettingsAsking | undefined>();
  const retiring = useConsoleWrite(
    usageSettingsRetireWrite(props.agent, name),
    {
      drawn: true,
    },
  );
  const turning = useConsoleWrite(usageSettingsTurnWrite(props.agent, name), {
    drawn: true,
  });
  return (
    <span className="grid justify-items-start gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-medium">{name}</span>
        {agentAccountCredentialOff(props.credential) ? (
          <Pill tone="parked">{text(agentAccountCredentialOffWord)}</Pill>
        ) : null}
        {asking === undefined ? (
          <UsageSettingsCredentialPresses
            credential={props.credential}
            turning={turning.isPending}
            retiring={retiring.isPending}
            onAsk={(asked) => {
              retiring.reset();
              turning.reset();
              setAsking(asked);
            }}
            onTurnOn={() => {
              retiring.reset();
              turning.mutate(false);
            }}
          />
        ) : null}
      </span>
      {asking === undefined ? null : (
        <UsageSettingsCredentialAsked
          asking={asking}
          credential={name}
          onConfirm={() => {
            setAsking(undefined);
            if (asking === "Retire") retiring.mutate(undefined);
            else turning.mutate(true);
          }}
          onCancel={() => {
            setAsking(undefined);
          }}
        />
      )}
      {[retiring.error, turning.error].map((error, index) =>
        error === null ? null : (
          <Notice key={index} tone="danger" inline>
            <ConsoleWriteRefusedWords refused={error} />
          </Notice>
        ),
      )}
    </span>
  );
}

/** Each window's reading and the share it pauses at, and both options, as read. */
function UsageSettingsRead(props: {
  readonly account: AgentAccount;
  readonly credentials: readonly AgentAccountCredential[] | undefined;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const settings = props.account.settings;
  const options = (pauses: boolean): Copy =>
    pauses
      ? { id: "usage-threads-pause-with" }
      : { id: "usage-threads-keep-running" };
  const layout =
    props.credentials === undefined || props.credentials.length === 0
      ? "inline-flex flex-wrap items-center gap-2"
      : "grid justify-items-start gap-1";
  return (
    <Fields>
      {usageSettingsPercentNames.map((name) => (
        <Field key={name} name={text(usageSettingsPercentLabel(name))}>
          <span className={layout}>
            <UsageSettingsReadings
              account={props.account}
              credentials={props.credentials}
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
      {props.credentials === undefined ||
      props.credentials.length === 0 ? null : (
        <Field name={text({ id: "usage-credentials" })}>
          <span className="grid justify-items-start gap-2">
            {props.credentials.map((credential) => (
              <UsageSettingsCredential
                key={credential.name}
                agent={props.account.agent}
                credential={credential}
              />
            ))}
          </span>
        </Field>
      )}
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
  const credentials = agentAccountCredentialsDrawn(account, nowMs);
  return (
    <SettingsSection
      title={text(accountAgentLabel(account.agent))}
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
          credentials={credentials}
          nowMs={nowMs}
        />
      )}
      {draft === undefined ? (
        <UsageSettingsRead
          account={account}
          credentials={credentials}
          nowMs={nowMs}
        />
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
