/**
 * Making a project: the workspace it belongs to, what it is called, the address
 * that makes, and one submit, at its own address, where the address may name
 * the workspace the form starts on. The workspace is a choice among the ones the reader may add a project
 * to, and a typed name's rule stands under its field before anything is typed.
 *
 * The project's address stands under its name as the name makes it, with the
 * control that edits it, and is a box of its own once that is pressed or the
 * name makes none.
 *
 * The page is the welcome page's column: a centred heading, and under it a
 * framed card holding the folded setup prompt over the form.
 *
 * A reader with nothing to choose is drawn an empty state where the form
 * would be, and neither the prompt nor the page's heading is drawn over it.
 *
 * The last press's operation identity belongs to the names it sent. A press
 * while the form holds those repeats that creation, as after an answer that
 * never arrived, and any others go under an identity of their own.
 */

import { useNavigate } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { ProjectCreatedResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { apiCreateProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import {
  projectAddressOf,
  projectCreationAddress,
  projectCreationAddressAsked,
  projectCreationNameFault,
  projectCreationNameLine,
  projectCreationRefusalLabel,
  projectCreationSendable,
  projectCreationStanding,
  projectNameRule,
} from "../core/projectCreation.ts";
import type {
  ProjectCreationForm as ProjectCreationFields,
  ProjectCreationNaming,
  ProjectCreationSent,
} from "../core/projectCreation.ts";
import {
  projectCreationWorkspaceChosen,
  projectCreationWorkspaceEntryText,
  projectCreationWorkspaceNamed,
  projectCreationWorkspaceOffer,
  projectCreationWorkspacePicked,
  projectCreationWorkspaceTenant,
} from "../core/projectCreationWorkspace.ts";
import type {
  ProjectCreationWorkspaceDrawn,
  ProjectCreationWorkspaceOffer,
  ProjectCreationWorkspaceSaid,
} from "../core/projectCreationWorkspace.ts";
import {
  callerSiteAbilitiesQuery,
  callerTenantsQuery,
  projectsInventoryQuery,
} from "../core/tenantQueries.ts";
import { usePanelState } from "./api.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import { copyOrDataText } from "../core/copy.ts";
import type { CopyText } from "../core/copy.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { Footer } from "./Footer.tsx";
import { clipboardWritten, drawBytes, persistentStore } from "./ports.ts";
import { SetupPrompt } from "./SetupPrompt.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";

const fieldClassName = "grid gap-1 text-sm text-ink-2";

function drawnOperation(): string {
  return base64urlFromBytes(drawBytes(operationIdBytesCount));
}

interface ProjectCreationNameProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** A name's box and, under it, the rule or the name's fault against it. */
function ProjectCreationNameBox(props: ProjectCreationNameProps): ReactNode {
  const text = useCopyText();
  const ruleId = useId();
  const fault = projectCreationNameFault(props.value);
  return (
    <>
      <Input
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        invalid={fault !== undefined}
        describedBy={ruleId}
      />
      <span
        id={ruleId}
        className={`text-xs ${fault === undefined ? "text-ink-3" : "text-tone-fail"}`}
      >
        {text(fault ?? projectNameRule)}
      </span>
    </>
  );
}

function ProjectCreationName(props: ProjectCreationNameProps): ReactNode {
  return (
    <label className={fieldClassName}>
      {props.label}
      <ProjectCreationNameBox {...props} />
    </label>
  );
}

/** What the project is called, the line under it saying the address that
 * makes, and the box the address is typed into once it is asked for. */
function ProjectCreationNamed(props: {
  readonly naming: ProjectCreationNaming;
  readonly onName: (naming: ProjectCreationNaming) => void;
}): ReactNode {
  const text = useCopyText();
  const lineId = useId();
  const { naming, onName } = props;
  const { line, fault } = projectCreationNameLine(naming);
  const asked = projectCreationAddressAsked(naming);
  const label = text({ id: "project-creation-project-label" });
  return (
    <>
      <div className={fieldClassName}>
        <span>{label}</span>
        <Input
          label={label}
          value={naming.name}
          onChange={(name) => {
            onName({ ...naming, name });
          }}
          invalid={fault}
          describedBy={lineId}
        />
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            id={lineId}
            className={`text-xs ${fault ? "text-tone-fail" : "text-ink-3"}`}
          >
            {text(line)}
          </span>
          {asked || projectAddressOf(naming.name) === "" ? null : (
            <Button
              size="sm"
              onClick={() => {
                onName({ ...naming, address: projectAddressOf(naming.name) });
              }}
            >
              {text({ id: "project-creation-address-edit" })}
            </Button>
          )}
        </span>
      </div>
      {asked ? (
        <ProjectCreationName
          label={text({ id: "project-creation-address-label" })}
          value={projectCreationAddress(naming)}
          onChange={(address) => {
            onName({ ...naming, address });
          }}
        />
      ) : null}
    </>
  );
}

interface ProjectCreationWorkspaceProps {
  readonly said: ProjectCreationWorkspaceSaid;
  readonly onSay: (said: ProjectCreationWorkspaceSaid) => void;
}

/** The choice, its entries told apart by their place in it because a
 * workspace may be called what another entry is, and the name field under it
 * while the making of a workspace is chosen. With no entry chosen it asks. */
function ProjectCreationWorkspaceChoice(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: Extract<
      ProjectCreationWorkspaceOffer,
      { readonly offer: "Choice" }
    >;
  },
): ReactNode {
  const text = useCopyText();
  const { offer, said, onSay } = props;
  const chosen = projectCreationWorkspaceChosen(offer, said);
  const workspaceLabel = text({ id: "project-creation-workspace-label" });
  return (
    <div className={fieldClassName}>
      <span>{workspaceLabel}</span>
      <div className="min-w-0">
        <Picker
          label={workspaceLabel}
          align="start"
          value={
            chosen === undefined ? "" : String(offer.entries.indexOf(chosen))
          }
          placeholder={text({ id: "project-creation-workspace-choose" })}
          options={offer.entries.map((entry, at) => ({
            value: String(at),
            text: copyOrDataText(
              text,
              projectCreationWorkspaceEntryText(entry),
            ),
          }))}
          onChoose={(at) => {
            const picked = offer.entries[Number(at)];
            if (picked !== undefined)
              onSay(projectCreationWorkspacePicked(offer, said, picked));
          }}
        />
      </div>
      {chosen?.entry === "New" ? (
        <ProjectCreationNameBox
          label={workspaceLabel}
          value={projectCreationWorkspaceTenant(offer, said)}
          onChange={(name) => {
            onSay(projectCreationWorkspaceNamed(offer, name));
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectCreationWorkspace(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: ProjectCreationWorkspaceDrawn;
  },
): ReactNode {
  const text = useCopyText();
  const { offer, said, onSay } = props;
  const workspaceLabel = text({ id: "project-creation-workspace-label" });
  switch (offer.offer) {
    case "Pending":
      return (
        <div className={fieldClassName}>
          <span>{workspaceLabel}</span>
          <PanelUnready state={{ state: "Pending" }} />
        </div>
      );
    case "Typed":
      return (
        <ProjectCreationName
          label={workspaceLabel}
          value={projectCreationWorkspaceTenant(offer, said)}
          onChange={(name) => {
            onSay(projectCreationWorkspaceNamed(offer, name));
          }}
        />
      );
    case "Choice":
      return (
        <ProjectCreationWorkspaceChoice
          offer={offer}
          said={said}
          onSay={onSay}
        />
      );
  }
}

/** One creation under the identity its press drew or repeated, over once the
 * projects inventory has been read again with it, and then the new project's
 * repositories, whether or not the form is still drawn. */
function projectCreationWrite(
  navigate: UseNavigateResult<string>,
  text: CopyText,
): ConsoleWrite<ProjectCreationSent, ProjectCreatedResponse> {
  return {
    mutationKey: consoleWriteKey("project-creation"),
    write: (ports, sent) =>
      apiCreateProject(ports, sent.fields, sent.operation),
    refusal: (failure) => text(projectCreationRefusalLabel(failure)),
    landed: async (client, created) => {
      lastProjectWrite(persistentStore, created);
      await client.invalidateQueries({
        queryKey: projectsInventoryQuery().queryKey,
      });
      void navigate({
        to: "/$tenant/$project/repositories",
        params: { tenant: created.tenant, project: created.project },
      });
    },
  };
}

/** The press that sends these names, and the line a refusal of them left,
 * which is drawn only while the form holds the names it answered. */
function useProjectCreationSend(fields: ProjectCreationFields): {
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly create: () => void;
} {
  const navigate = useNavigate();
  const text = useCopyText();
  const creating = useConsoleWrite(projectCreationWrite(navigate, text), {
    drawn: (_, sent) => projectCreationStanding(sent, fields) !== undefined,
  });
  const standing = projectCreationStanding(creating.variables, fields);
  const create = (): void => {
    const operation = standing?.operation ?? drawnOperation();
    creating.mutate({ fields, operation });
  };
  return {
    busy: creating.isPending,
    status: standing === undefined ? undefined : creating.error?.message,
    create,
  };
}

function ProjectCreationForm(props: {
  readonly offer: ProjectCreationWorkspaceDrawn;
}): ReactNode {
  const [workspace, setWorkspace] =
    useState<ProjectCreationWorkspaceSaid>(undefined);
  const [naming, setNaming] = useState<ProjectCreationNaming>({ name: "" });
  const fields: ProjectCreationFields = {
    tenant: projectCreationWorkspaceTenant(props.offer, workspace),
    project: projectCreationAddress(naming),
    name: naming.name,
  };
  const send = useProjectCreationSend(fields);
  const text = useCopyText();
  return (
    <div className="grid gap-3">
      <ProjectCreationWorkspace
        offer={props.offer}
        said={workspace}
        onSay={setWorkspace}
      />
      <ProjectCreationNamed naming={naming} onName={setNaming} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="primary"
          disabled={!projectCreationSendable(fields) || send.busy}
          busy={send.busy}
          onClick={send.create}
        >
          {text({ id: "project-creation-submit" })}
        </Button>
        {send.status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={send.status} />
        )}
      </div>
    </div>
  );
}

/**
 * The prompt and the form under the page's heading, the form starting on the
 * workspace it is given, or the empty state that stands in for all of it.
 */
function ProjectCreation(props: {
  readonly workspace: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const offer = projectCreationWorkspaceOffer(
    usePanelState(callerTenantsQuery()),
    usePanelState(callerSiteAbilitiesQuery()),
    props.workspace,
  );
  if (offer.offer === "Withheld")
    return (
      <EmptyState
        variant="page"
        label={text(offer.label)}
        detail={text(offer.detail)}
      />
    );
  return (
    <ProjectlessColumn title={text({ id: "project-creation-new-title" })}>
      <SetupPrompt folded />
      <ProjectCreationForm offer={offer} />
    </ProjectlessColumn>
  );
}

/** A screen outside every project: the bar, the page under it, and the footer
 * at the foot of the viewport, with the clipboard a copy control under it asks for. */
export function ProjectlessFrame(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <CopyProvider write={clipboardWritten}>
      <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto]">
        <TopBar partition={undefined} />
        <main className="grid content-start gap-4 p-4">{props.children}</main>
        <div className="px-4 pb-4">
          <Footer />
        </div>
      </div>
    </CopyProvider>
  );
}

/** A page outside every project as one column centred under the bar: its
 * heading, and under it a framed card holding the rest. */
export function ProjectlessColumn(props: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="mx-auto grid w-full max-w-measure gap-4">
      <h1 className="text-md font-strong text-ink-1 text-center">
        {props.title}
      </h1>
      <div className="bg-surface-1 border-edge rounded-3 grid gap-4 border p-5">
        {props.children}
      </div>
    </div>
  );
}

export function ProjectCreationPage(props: {
  readonly workspace?: string | undefined;
}): ReactNode {
  return (
    <ProjectlessFrame>
      <ProjectCreation workspace={props.workspace} />
    </ProjectlessFrame>
  );
}
