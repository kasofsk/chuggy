/**
 * The project's repositories: what it binds, and what it could bind from the
 * tenant's own connected accounts.
 *
 * The bindings below are the live ones, which are what a ticket may name; a
 * retired one is not listed, and its page is reached only by its address. A
 * binding is added from what those installations grant rather than from a
 * typed address. A binding the project holds no configuration for
 * is drawn as deferred, with its configuration step offered again on its row,
 * and one the worker app cannot be said to reach says why on its row, with the
 * installation's page on GitHub where its selection is what is missing.
 * The rows are drawn from the read that does not ask the forge, and the reach
 * marks are laid on them when the read that asks it answers; one that has not
 * answered, or failed, leaves the rows drawn and unmarked.
 * Each binding offers Unbind unless the abilities read refuses this reader
 * `administer`, which is the permit the retirement route asks.
 * The line under Add says why it is withheld, or that a connected account
 * lacks the worker app. The accounts are the tenant's, and where the line
 * names a step this reader can take here, it is drawn as one of the numbered
 * steps to a first repository: Connect GitHub where the workspace holds no
 * account, and the worker app's install where one it holds lacks that app,
 * each returning to this page. A return from the forge that did not simply
 * connect says so in one line above them, until the person leaves.
 *
 * THE PICKER HAS AN ADDRESS, this page's own at the anchor
 * `ui/chuggy-ui/app/core/projectRepositories.ts` names, and a grant made on
 * the forge from the picker returns to it: the page opens with the picker open
 * and its roster read, unless the return brought a word to read first. The
 * address loses the anchor, in the entry it is in, when the picker closes and
 * when a bind is accepted, so neither a reload nor Back opens the picker and
 * reads its roster again.
 *
 * ADD IS THE STEP BEING TAKEN UNDER AN EMPTY ROSTER, where adding is the one
 * thing left to do, and opens the dialog the head's Add opens. The step says
 * how a repository comes to be listed there: made on GitHub and granted to
 * both apps. `ui/chuggy-ui/app/core/projectRepositories.ts` decides when.
 * WHILE A STEP IS BEING TAKEN ITS PRESS IS THE PAGE'S ONE PRIMARY, and the
 * head's Add is drawn as a secondary.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryWorkerReachResponse,
} from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { instantFigure } from "../core/figures.ts";
import {
  forgePortalInstallations,
  forgeWorkerInstallations,
} from "../core/forgeInstallation.ts";
import type { ForgeReturnWord } from "../core/forgeReturn.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import {
  repositoryAddClosedPath,
  repositoryAddHow,
  repositoryAddLeads,
  repositoryAddOpened,
  repositoryHost,
  repositoryLabel,
  repositoryOffersLine,
  repositoryStepCurrent,
  repositoryStepLabels,
  repositorySteps,
} from "../core/projectRepositories.ts";
import type {
  RepositoryOffersLine,
  RepositoryStep,
} from "../core/projectRepositories.ts";
import {
  projectForgeAppsQuery,
  projectRepositoriesQuery,
  projectRepositoriesReachUnaskedQuery,
} from "../core/projectQueries.ts";
import { forgeInstallationsQuery } from "../core/tenantQueries.ts";
import type { WorkRunner } from "../core/workRunner.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { currentAnchor, currentPath } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { AddRepository } from "./repositories/AddRepository.tsx";
import { BindingConfigurations } from "./repositories/BindingConfigurations.tsx";
import { BindingWorkerReach } from "./repositories/BindingWorkerReach.tsx";
import { ConnectGithub } from "./repositories/ConnectGithub.tsx";
import {
  ForgeReturned,
  useForgeReturned,
} from "./repositories/ForgeReturned.tsx";
import { InstallLink } from "./repositories/InstallLink.tsx";
import { repositoryRoutePath } from "./repositories/RepositoryPage.tsx";
import {
  UnbindAsked,
  UnbindPress,
  useRepositoryUnbinding,
} from "./repositories/UnbindRepository.tsx";
import type { RepositoryUnbinding } from "./repositories/UnbindRepository.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { PageHeader } from "./ui/PageHeader.tsx";
import { RecordList, RecordRow } from "./ui/RecordList.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { useWorkRunner } from "./workRunner.tsx";

import "./repositories/Repositories.css";

/** This page's own address, which its parameters are read from. */
const repositoriesRoutePath = "/$tenant/$project/repositories";

/** What the worker app reaches of each binding, by its repository, where the
 * read that asks has answered; a binding it reaches maps to nothing. */
type BindingReaches = ReadonlyMap<
  string,
  ProjectRepositoryWorkerReachResponse | undefined
>;

function BindingRow(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryListedResponse;
  /** Why the worker app cannot be said to reach it, nothing where it does or
   * that has not been read. */
  readonly workerReach: ProjectRepositoryWorkerReachResponse | undefined;
  readonly nowMs: number;
  /** The listing's unbinding, where its rows offer one. */
  readonly unbinding: RepositoryUnbinding | undefined;
}): ReactNode {
  const text = useCopyText();
  const binding = props.binding;
  return (
    <RecordRow
      title={repositoryLabel(binding.repository)}
      link={{
        to: repositoryRoutePath,
        params: { ...props.partition, repository: binding.repository },
      }}
      level={2}
      meta={
        <>
          <Tooltip text={binding.repository}>
            <span>
              {repositoryHost(binding.repository) ?? binding.repository}
            </span>
          </Tooltip>
          <span className="flex items-center gap-1">
            {text({ id: "repositories-bound" })}
            <Figure figure={instantFigure(binding.boundAt, props.nowMs)} />
          </span>
        </>
      }
      foot={
        <>
          <span className="repositories-attention">
            {binding.configured ? null : (
              <BindingConfigurations
                partition={props.partition}
                repository={binding.repository}
              />
            )}
            {props.workerReach === undefined ? null : (
              <BindingWorkerReach reach={props.workerReach} />
            )}
          </span>
          {props.unbinding === undefined ? null : (
            <span className="ms-auto">
              <UnbindPress
                repository={binding.repository}
                unbinding={props.unbinding}
              />
            </span>
          )}
        </>
      }
    />
  );
}

/**
 * The listing's unbinding, where its rows offer one: the abilities read did
 * not refuse this reader the permit it asks, and a binding is listed.
 */
function useBindingUnbinding(
  partition: PartitionIdentity,
  listed: boolean,
): RepositoryUnbinding | undefined {
  const refused = projectAbilityRefused(
    useProjectAbilities(partition),
    "administer",
  );
  const unbinding = useRepositoryUnbinding(partition, listed && !refused);
  return refused ? undefined : unbinding;
}

/** The bindings, or the line that says there are none. */
function BindingList(props: {
  readonly partition: PartitionIdentity;
  readonly bindings: readonly ProjectRepositoryListedResponse[];
  readonly reaches: BindingReaches | undefined;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  const unbinding = useBindingUnbinding(
    props.partition,
    props.bindings.length > 0,
  );
  if (props.bindings.length === 0)
    return <EmptyState label={text({ id: "repositories-none" })} />;
  return (
    <>
      <RecordList label={text({ id: "repositories-bound-caption" })}>
        {props.bindings.map((binding) => (
          <BindingRow
            key={binding.repository}
            partition={props.partition}
            binding={binding}
            workerReach={props.reaches?.get(binding.repository)}
            nowMs={nowMs}
            unbinding={unbinding}
          />
        ))}
      </RecordList>
      {unbinding === undefined ? null : <UnbindAsked unbinding={unbinding} />}
    </>
  );
}

/** The one press the step being taken offers, drawn as the page's primary. */
function RepositoryStepAction(props: {
  readonly tenant: string;
  readonly step: RepositoryStep;
  readonly onAdd: () => void;
}): ReactNode {
  const text = useCopyText();
  switch (props.step) {
    case "Connect":
      return (
        <ConnectGithub
          tenant={props.tenant}
          returnPath={currentPath()}
          variant="primary"
        />
      );
    case "InstallWorker":
      return (
        <InstallLink
          tenant={props.tenant}
          returnPath={currentPath()}
          app="worker"
          variant="primary"
        />
      );
    case "Add":
      return (
        <Button size="sm" variant="primary" onClick={props.onAdd}>
          {text({ id: "repositories-add" })}
        </Button>
      );
  }
}

/**
 * The steps to a first repository, numbered: those before the one being taken
 * are done, it says what the line under Add says with its one press beside
 * it, and those after it are named only.
 */
function RepositoryStepsDrawn(props: {
  readonly tenant: string;
  readonly current: RepositoryStep;
  readonly line: RepositoryOffersLine | undefined;
  readonly onAdd: () => void;
}): ReactNode {
  const text = useCopyText();
  const at = repositorySteps.indexOf(props.current);
  return (
    <ol
      className="repository-steps"
      aria-label={text({ id: "repositories-steps" })}
    >
      {repositorySteps.map((step, index) => (
        <li
          key={step}
          className="repository-step"
          aria-current={index === at ? "step" : undefined}
        >
          <span className="repository-step-body">
            <span className="repository-step-said">
              {index === at
                ? text(props.line?.status ?? repositoryAddHow)
                : text(repositoryStepLabels[step])}
            </span>
            {index < at ? (
              <span className="repository-step-done">
                {text({ id: "repositories-step-done" })}
              </span>
            ) : null}
            {index === at ? (
              <RepositoryStepAction
                tenant={props.tenant}
                step={step}
                onAdd={props.onAdd}
              />
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What the page says before its list: the numbered steps where one is to be
 * taken, and otherwise the line under Add where there is one. */
function RepositoryOffers(props: {
  readonly tenant: string;
  readonly line: RepositoryOffersLine | undefined;
  readonly current: RepositoryStep | undefined;
  readonly onAdd: () => void;
}): ReactNode {
  const text = useCopyText();
  if (props.current !== undefined)
    return (
      <RepositoryStepsDrawn
        tenant={props.tenant}
        current={props.current}
        line={props.line}
        onAdd={props.onAdd}
      />
    );
  if (props.line === undefined) return null;
  return <Notice tone="parked" inline detail={text(props.line.status)} />;
}

/**
 * Whether the picker is open, which the address it was drawn at decides first.
 * A close, and a bind told through `bound`, take the picker's anchor off the
 * address in the entry it is in, where the address carries it.
 */
function usePicker(returned: ForgeReturnWord | undefined): {
  readonly open: boolean;
  readonly opened: (open: boolean) => void;
  readonly bound: () => void;
} {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() =>
    repositoryAddOpened(currentAnchor(), returned),
  );
  const left = (): void => {
    const path = repositoryAddClosedPath(currentPath(), currentAnchor());
    if (path !== undefined)
      void navigate({ href: path, replace: true, resetScroll: false });
  };
  return {
    open,
    opened: (next) => {
      setOpen(next);
      if (!next) left();
    },
    bound: left,
  };
}

/** The page's head, holding Add, then the steps or the line under it, and
 * the bindings. */
function RepositoriesSection(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bindings: readonly ProjectRepositoryListedResponse[] | undefined;
  readonly reaches: BindingReaches | undefined;
  readonly line: RepositoryOffersLine | undefined;
  readonly returned: ForgeReturnWord | undefined;
  readonly unready: ReactNode;
  readonly runner: WorkRunner;
}): ReactNode {
  const text = useCopyText();
  const bindings = props.bindings?.filter(
    (binding) => binding.retiredAt === undefined,
  );
  const picker = usePicker(props.returned);
  const portal = forgePortalInstallations(props.installations);
  const current = repositoryStepCurrent(
    props.line,
    repositoryAddLeads({
      bindings,
      installations: props.installations,
      line: props.line,
    }),
  );
  const add = {
    label: text({ id: "repositories-add" }),
    onPress: () => {
      picker.opened(true);
    },
    disabled: portal.length === 0,
  };
  return (
    <>
      <PageHeader
        title={text({ id: "repositories-title" })}
        description={text({ id: "repositories-about" })}
        {...(current === undefined ? { primary: add } : { secondary: [add] })}
      />
      <AddRepository
        partition={props.partition}
        installations={portal}
        workers={forgeWorkerInstallations(props.installations)}
        bound={bindings ?? []}
        runner={props.runner}
        open={picker.open}
        onOpenChange={picker.opened}
        onBound={picker.bound}
      />
      <ForgeReturned word={props.returned} />
      <RepositoryOffers
        tenant={props.partition.tenant}
        line={props.line}
        current={current}
        onAdd={() => {
          picker.opened(true);
        }}
      />
      {props.unready}
      {bindings === undefined ? null : (
        <BindingList
          partition={props.partition}
          bindings={bindings}
          reaches={props.reaches}
        />
      )}
    </>
  );
}

export function RepositoriesPage(): ReactNode {
  const params = useParams({ from: repositoriesRoutePath });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const accounts = usePanelState(forgeInstallationsQuery(partition.tenant));
  const apps = usePanelState(projectForgeAppsQuery(partition));
  const bindings = usePanelState(
    projectRepositoriesReachUnaskedQuery(partition),
  );
  const reached = usePanelState(projectRepositoriesQuery(partition));
  const returned = useForgeReturned(partition.tenant);
  const runner = useWorkRunner(partition, "Reader");
  return (
    <div
      className="repositories-page grid min-w-0 max-w-settings gap-4"
      data-fills-width
    >
      <RepositoriesSection
        partition={partition}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : []
        }
        bindings={
          bindings.state === "Ready" ? bindings.value.repositories : undefined
        }
        reaches={
          reached.state === "Ready"
            ? new Map(
                reached.value.repositories.map((binding) => [
                  binding.repository,
                  binding.workerReach,
                ]),
              )
            : undefined
        }
        line={repositoryOffersLine(accounts, apps)}
        returned={returned}
        unready={<PanelUnready state={bindings} />}
        runner={runner}
      />
    </div>
  );
}
