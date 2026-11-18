/**
 * One repository being connected to the project, once it is chosen: the
 * repository in its heading throughout, each app with what it is for, where
 * it stands on the repository and the one press that puts it right on the
 * forge, and, once both reach it, the bind made without a press and the way
 * on.
 *
 * Where each app stands is read again on a clock of its own while either does
 * not reach the repository, because the forge can be slow to list a grant
 * just made and nothing tells this console when it does. A reading costs the
 * forge a request, so the readings are counted and stop;
 * `ui/chuggy-ui/app/core/projectRepositories.ts` names the pace and the count.
 *
 * EVERY PRESS RETURNS HERE, to the address carrying the repository and who
 * sent the person, and is stored as a press the landings send nowhere else:
 * the other app's press is this page's, with the repository chosen where the
 * forge can take it.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ForgeRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { apiBindProjectRepository } from "../../core/apiRoutes.ts";
import type { ProjectRepositoryBindAnswer } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { copyOrDataText } from "../../core/copy.ts";
import type { Copy } from "../../core/copy.ts";
import {
  forgeInstallBegin,
  forgeInstallOffered,
  forgeInstallState,
} from "../../core/forgeInstallation.ts";
import type { ForgeReturnWord } from "../../core/forgeReturn.ts";
import type { PanelState } from "../../core/freshness.ts";
import { operationIdBytesCount } from "../../core/operationFollow.ts";
import { projectRepositoriesInvalidated } from "../../core/projectQueries.ts";
import {
  repositoryAddReturnPath,
  repositoryBindNote,
  repositoryBindOutcome,
  repositoryRosterRereadMs,
} from "../../core/projectRepositories.ts";
import type { RepositoryNote } from "../../core/projectRepositories.ts";
import {
  repositoryConnectBindable,
  repositoryConnectChooseLine,
  repositoryConnectInstallUrl,
  repositoryConnectLeft,
  repositoryConnectPath,
  repositoryConnectPress,
  repositoryConnectReachLine,
  repositoryConnectRead,
  repositoryConnectReasons,
  repositoryNamedLabel,
} from "../../core/repositoryConnect.ts";
import type {
  RepositoryAppReach,
  RepositoryConnectArrival,
  RepositoryNamed,
} from "../../core/repositoryConnect.ts";
import {
  forgeAppsQuery,
  forgeRepositoryReachQuery,
} from "../../core/tenantQueries.ts";
import type { WorkRunner } from "../../core/workRunner.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { currentPath, drawBytes, transientStore } from "../ports.ts";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { ConnectGithub } from "./ConnectGithub.tsx";
import { ForgeReturned } from "./ForgeReturned.tsx";
import { RepositoryNextStep } from "./RepositoryNextStep.tsx";

/** One bind: the portal app's entry for the repository, and the identity drawn for it. */
interface ConnectBindAsked {
  readonly repository: ForgeRepositoryResponse;
  readonly identity: string;
}

/** One bind, from the identity its press drew to the line it leaves behind,
 * over only once the bindings it changed have been read again. */
function repositoryBindWrite(
  partition: PartitionIdentity,
): ConsoleWrite<ConnectBindAsked, ProjectRepositoryBindAnswer> {
  return {
    mutationKey: consoleWriteKey(
      "repository-bind",
      partition.tenant,
      partition.project,
    ),
    write: (ports, asked) =>
      apiBindProjectRepository(
        ports,
        partition,
        { repository: asked.repository.url },
        asked.identity,
      ),
    refusal: (failure) =>
      repositoryBindNote(repositoryBindOutcome(failure)).status,
    landed: (client) => projectRepositoriesInvalidated(client, partition),
  };
}

/** The line a bind left: what it bound, or the refusal in the same place. */
function repositoryBindNoted(
  binding: ConsoleWriting<ConnectBindAsked, ProjectRepositoryBindAnswer>,
): RepositoryNote | undefined {
  if (binding.error !== null)
    return { status: binding.error.message, ticketOffered: false };
  if (binding.isPending || binding.data === undefined) return undefined;
  return repositoryBindNote(
    repositoryBindOutcome({ outcome: "Ok", value: binding.data }),
  );
}

/**
 * Where each app stands on the repository, read again on the flow's clock
 * until both reach it or the readings are spent.
 */
function useRepositoryReach(
  tenant: string,
  named: RepositoryNamed,
): PanelState<readonly RepositoryAppReach[]> {
  const [reads, setReads] = useState(0);
  const [reached, setReached] = useState(false);
  const state = usePanelState(
    forgeRepositoryReachQuery(
      tenant,
      repositoryNamedLabel(named).toLowerCase(),
      (ports) => {
        setReads((made) => made + 1);
        return repositoryConnectRead(ports, tenant, named);
      },
      reached ? undefined : repositoryRosterRereadMs(reads),
    ),
  );
  const bindable =
    state.state === "Ready" &&
    repositoryConnectBindable(state.value) !== undefined;
  if (bindable && !reached) setReached(true);
  return state;
}

/** One app's press on the forge: its install, with the repository chosen
 * where the address can carry it, or its installation's own page. */
function ConnectAppPress(props: {
  readonly tenant: string;
  readonly reach: RepositoryAppReach;
  readonly apps: readonly RepositoryAppReach[];
  readonly named: RepositoryNamed;
  readonly returnPath: string;
}): ReactNode {
  const text = useCopyText();
  const offered = usePanelState(forgeAppsQuery(props.tenant));
  const [state] = useState(() => forgeInstallState(drawBytes));
  const reach = props.reach;
  if (reach.reach === "Reaches") return null;
  const held =
    offered.state === "Ready"
      ? forgeInstallOffered(offered.value, reach.app)
      : undefined;
  if (held === undefined) return null;
  const install = repositoryConnectInstallUrl(held, state, props.apps);
  const settings = reach.reach === "Ungranted" ? reach.settings : undefined;
  const choose = repositoryConnectChooseLine(
    reach,
    props.named,
    install.chosen,
  );
  return (
    <>
      <div className="flex">
        <a
          href={settings ?? install.url}
          className={buttonLookClassName({ size: "sm", variant: "primary" })}
          onClick={() => {
            forgeInstallBegin(transientStore, {
              ...repositoryConnectPress(props.tenant, props.returnPath),
              state,
            });
          }}
        >
          {text({
            id:
              settings === undefined
                ? "repositories-connect-install"
                : "repositories-connect-let-in",
          })}
        </a>
      </div>
      {choose === undefined ? null : (
        <p className="text-sm text-ink-3">{text(choose)}</p>
      )}
    </>
  );
}

const connectAppNames = {
  portal: { id: "repositories-portal-app" },
  worker: { id: "repositories-worker-app" },
} as const satisfies Readonly<Record<RepositoryAppReach["app"], Copy>>;

/** One app: its name, what it is for, where it stands, and its press. */
function ConnectApp(props: {
  readonly tenant: string;
  readonly reach: RepositoryAppReach;
  readonly apps: readonly RepositoryAppReach[];
  readonly named: RepositoryNamed;
  readonly returnPath: string;
}): ReactNode {
  const text = useCopyText();
  const reach = props.reach;
  return (
    <li className="grid gap-1">
      <span className="font-strong text-ink-1">
        {text(connectAppNames[reach.app])}
      </span>
      <span className="text-sm text-ink-3">
        {text(repositoryConnectReasons[reach.app])}
      </span>
      <Notice
        tone={reach.reach === "Reaches" ? "info" : "parked"}
        inline
        detail={text(repositoryConnectReachLine(reach, props.named))}
      />
      <ConnectAppPress {...props} />
    </li>
  );
}

/** Both apps, what is left, and the way to a claim the forge holds and this
 * workspace has not seen. */
function ConnectApps(props: {
  readonly tenant: string;
  readonly apps: readonly RepositoryAppReach[];
  readonly named: RepositoryNamed;
  readonly returnPath: string;
}): ReactNode {
  const text = useCopyText();
  const left = repositoryConnectLeft(props.apps);
  const repository = repositoryNamedLabel(props.named);
  return (
    <>
      <p className="text-sm text-ink-3">
        {text({ id: "repositories-connect-apps", args: { repository } })}
      </p>
      <ul className="grid gap-3">
        {props.apps.map((reach) => (
          <ConnectApp
            key={reach.app}
            tenant={props.tenant}
            reach={reach}
            apps={props.apps}
            named={props.named}
            returnPath={props.returnPath}
          />
        ))}
      </ul>
      <Notice
        tone="parked"
        inline
        role="status"
        detail={text({
          id: "repositories-connect-left",
          args: { count: left.length, app: left[0] ?? "" },
        })}
      />
      {props.apps.some((one) => one.reach === "Uninstalled") ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-3">
            {text({ id: "repositories-connect-unseen" })}
          </span>
          <ConnectGithub tenant={props.tenant} returnPath={props.returnPath} />
        </div>
      ) : null}
    </>
  );
}

function ConnectDoneApps(props: {
  readonly apps: readonly RepositoryAppReach[];
  readonly repository: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <ul className="grid gap-1">
      {props.apps.map((reach) => (
        <li key={reach.app} className="text-sm text-ink-1">
          {text({
            id: "repositories-connect-done-app",
            args: { app: reach.app, repository: props.repository },
          })}
        </li>
      ))}
    </ul>
  );
}

/** The finished state: the repository, both apps on it, the bind, and the way on. */
function ConnectDone(props: {
  readonly partition: PartitionIdentity;
  readonly named: RepositoryNamed;
  readonly apps: readonly RepositoryAppReach[];
  readonly binding: ConsoleWriting<
    ConnectBindAsked,
    ProjectRepositoryBindAnswer
  >;
  readonly note: RepositoryNote | undefined;
  readonly arrival: RepositoryConnectArrival;
  readonly runner: WorkRunner;
  readonly onDone: () => void;
}): ReactNode {
  const text = useCopyText();
  const repository = repositoryNamedLabel(props.named);
  const project = props.partition.project;
  const note = props.note;
  if (note === undefined)
    return <ConnectAdding repository={repository} project={project} />;
  const added = props.binding.error === null;
  return (
    <>
      <ConnectDoneApps apps={props.apps} repository={repository} />
      {added ? (
        <Notice
          tone="info"
          role="status"
          heading={text({
            id: "repositories-connect-done",
            args: { repository, project },
          })}
        />
      ) : null}
      <Notice
        tone={added ? "info" : "danger"}
        inline
        detail={copyOrDataText(text, note.status)}
        role="status"
      >
        {added ? (
          <RepositoryNextStep
            partition={props.partition}
            ticketOffered={note.ticketOffered}
            runner={props.runner}
          />
        ) : null}
      </Notice>
      {note.ignored === undefined ? null : (
        <Notice
          tone="parked"
          inline
          detail={text(note.ignored)}
          role="status"
        />
      )}
      {added ? (
        <ConnectWayOn arrival={props.arrival} onDone={props.onDone} />
      ) : null}
    </>
  );
}

function ConnectAdding(props: {
  readonly repository: string;
  readonly project: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <Notice
      tone="info"
      inline
      role="status"
      detail={text({ id: "repositories-connect-adding", args: props })}
    />
  );
}

/** The way on from a finished connection: back to the chat for a person setup
 * sent, and to the repository's row for one who came from the console. */
function ConnectWayOn(props: {
  readonly arrival: RepositoryConnectArrival;
  readonly onDone: () => void;
}): ReactNode {
  const text = useCopyText();
  switch (props.arrival) {
    case "Setup":
      return (
        <p className="text-sm text-ink-1">
          {text({ id: "repositories-connect-back-setup" })}
        </p>
      );
    case "Console":
      return (
        <div className="flex">
          <Button size="sm" variant="primary" onClick={props.onDone}>
            {text({ id: "repositories-connect-back-list" })}
          </Button>
        </div>
      );
  }
}

/** The word the person came back from the forge with, and what an approval
 * an owner was asked for waits on. */
function ConnectReturned(props: {
  readonly word: ForgeReturnWord | undefined;
  readonly named: RepositoryNamed;
}): ReactNode {
  const text = useCopyText();
  if (props.word === undefined) return null;
  return (
    <>
      <ForgeReturned word={props.word} />
      {props.word.status === "Requested" ? (
        <p className="text-sm text-ink-3">
          {text({
            id: "repositories-connect-requested",
            args: { account: props.named.owner },
          })}
        </p>
      ) : null}
    </>
  );
}

/** The bind, asked once for the repository as soon as both apps reach it. */
function useConnectBind(
  partition: PartitionIdentity,
  bindable: ForgeRepositoryResponse | undefined,
  bound: () => void,
): {
  readonly binding: ConsoleWriting<
    ConnectBindAsked,
    ProjectRepositoryBindAnswer
  >;
  readonly note: RepositoryNote | undefined;
} {
  const binding = useConsoleWrite(repositoryBindWrite(partition), {
    drawn: true,
  });
  const asked = useRef<string | undefined>(undefined);
  const mutate = binding.mutate;
  useEffect(() => {
    if (bindable === undefined || asked.current === bindable.url) return;
    asked.current = bindable.url;
    mutate(
      {
        repository: bindable,
        identity: base64urlFromBytes(drawBytes(operationIdBytesCount)),
      },
      { onSuccess: bound },
    );
  }, [bindable, mutate, bound]);
  return { binding, note: repositoryBindNoted(binding) };
}

export function ConnectRepository(props: {
  readonly partition: PartitionIdentity;
  readonly named: RepositoryNamed;
  readonly arrival: RepositoryConnectArrival;
  /** The word the person came back from the forge with, where they did. */
  readonly returned: ForgeReturnWord | undefined;
  readonly runner: WorkRunner;
  readonly onAnother: () => void;
  readonly onDone: () => void;
  /** Told of a bind the route accepted. */
  readonly onBound: () => void;
}): ReactNode {
  const text = useCopyText();
  const { partition, named } = props;
  const repository = repositoryNamedLabel(named);
  const state = useRepositoryReach(partition.tenant, named);
  const bindable =
    state.state === "Ready"
      ? repositoryConnectBindable(state.value)
      : undefined;
  const { binding, note } = useConnectBind(partition, bindable, props.onBound);
  const returnPath = repositoryAddReturnPath(
    repositoryConnectPath(currentPath(), {
      repository: named,
      arrival: props.arrival,
    }),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-md font-strong text-ink-1">
          {text({
            id: "repositories-connect-title",
            args: { repository, project: partition.project },
          })}
        </h3>
        {bindable === undefined ? (
          <Button size="sm" variant="quiet" onClick={props.onAnother}>
            {text({ id: "repositories-connect-another" })}
          </Button>
        ) : null}
      </div>
      <ConnectReturned word={props.returned} named={named} />
      <PanelUnready state={state} />
      {state.state !== "Ready" ? null : bindable === undefined ? (
        <ConnectApps
          tenant={partition.tenant}
          apps={state.value}
          named={named}
          returnPath={returnPath}
        />
      ) : (
        <ConnectDone
          partition={partition}
          named={named}
          apps={state.value}
          binding={binding}
          note={note}
          arrival={props.arrival}
          runner={props.runner}
          onDone={props.onDone}
        />
      )}
    </>
  );
}
