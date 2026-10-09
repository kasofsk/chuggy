/**
 * Making a project: the workspace it belongs to, its own name, and one submit,
 * on the landing a reader with no project meets and at its own address, where
 * the address may name the workspace the form starts on. The workspace is a
 * choice among the ones the reader may add a project to, and a typed name's
 * rule stands under its field before anything is typed.
 *
 * A reader with nothing to choose is drawn an empty state where the form
 * would be, and what its page leads the form with is not drawn over it.
 *
 * The last press's operation identity belongs to the two names it sent. A
 * press while the form holds those two repeats that creation, as after an
 * answer that never arrived, and any other two go under an identity of their
 * own.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { apiCallerTenants, apiSiteAbilities } from "../core/accessRoutes.ts";
import { apiCreateProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import {
  projectCreationNameFault,
  projectCreationOutcome,
  projectCreationSendable,
  projectCreationStanding,
  projectNameRule,
} from "../core/projectCreation.ts";
import type {
  ProjectCreationForm as ProjectCreationFields,
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
import { projectsInventoryKey } from "../core/projectQueryKeys.ts";
import { useApiPorts, usePanelCallerResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { Footer } from "./Footer.tsx";
import { clipboardWritten, drawBytes, persistentStore } from "./ports.ts";
import { siteAbilitiesResource } from "./settings/tenantPermissionsResource.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";

/** No frame names this read. */
const callerTenantsResource = "access-workspaces";

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
        {fault ?? projectNameRule}
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
  const { offer, said, onSay } = props;
  const chosen = projectCreationWorkspaceChosen(offer, said);
  return (
    <div className={fieldClassName}>
      <span>Workspace</span>
      <div className="min-w-0">
        <Picker
          label="Workspace"
          align="start"
          value={
            chosen === undefined ? "" : String(offer.entries.indexOf(chosen))
          }
          placeholder="Choose"
          options={offer.entries.map((entry, at) => ({
            value: String(at),
            text: projectCreationWorkspaceEntryText(entry),
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
          label="Workspace"
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
  const { offer, said, onSay } = props;
  switch (offer.offer) {
    case "Pending":
      return (
        <div className={fieldClassName}>
          <span>Workspace</span>
          <PanelUnready state={{ state: "Pending" }} />
        </div>
      );
    case "Typed":
      return (
        <ProjectCreationName
          label="Workspace"
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

/** The press that sends these two names, and the line a refusal of them left,
 * which is drawn only while the form holds the names it answered. */
function useProjectCreationSend(fields: ProjectCreationFields): {
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly create: () => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [sent, setSent] = useState<ProjectCreationSent | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const standing = projectCreationStanding(sent, fields);
  const create = (): void => {
    const operation = standing?.operation ?? drawnOperation();
    setSent({ fields, operation, status: undefined });
    setBusy(true);
    void (async () => {
      const outcome = projectCreationOutcome(
        await apiCreateProject(ports, fields, operation),
      );
      setBusy(false);
      if (outcome.outcome === "Refused") {
        setSent({ fields, operation, status: outcome.status });
        return;
      }
      lastProjectWrite(persistentStore, outcome.partition);
      await client.invalidateQueries({ queryKey: projectsInventoryKey() });
      void navigate({
        to: "/$tenant/$project/repositories",
        params: outcome.partition,
      });
    })();
  };
  return { busy, status: standing?.status, create };
}

function ProjectCreationForm(props: {
  readonly offer: ProjectCreationWorkspaceDrawn;
}): ReactNode {
  const [workspace, setWorkspace] =
    useState<ProjectCreationWorkspaceSaid>(undefined);
  const [project, setProject] = useState("");
  const fields: ProjectCreationFields = {
    tenant: projectCreationWorkspaceTenant(props.offer, workspace),
    project,
  };
  const send = useProjectCreationSend(fields);
  return (
    <div className="grid w-full max-w-aside gap-3">
      <ProjectCreationWorkspace
        offer={props.offer}
        said={workspace}
        onSay={setWorkspace}
      />
      <ProjectCreationName
        label="Project"
        value={project}
        onChange={setProject}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="primary"
          disabled={!projectCreationSendable(fields) || send.busy}
          busy={send.busy}
          onClick={send.create}
        >
          Create project
        </Button>
        {send.status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={send.status} />
        )}
      </div>
    </div>
  );
}

/**
 * The form under what its page leads it with, starting on the workspace it is
 * given, or the empty state that stands in for both.
 */
export function ProjectCreation(props: {
  readonly workspace?: string | undefined;
  readonly lead?: ReactNode;
}): ReactNode {
  const offer = projectCreationWorkspaceOffer(
    usePanelCallerResource(callerTenantsResource, (ports) =>
      apiCallerTenants(ports),
    ),
    usePanelCallerResource(siteAbilitiesResource, (ports) =>
      apiSiteAbilities(ports),
    ),
    props.workspace,
  );
  if (offer.offer === "Withheld")
    return (
      <EmptyState variant="page" label={offer.label} detail={offer.detail} />
    );
  return (
    <>
      {props.lead}
      <ProjectCreationForm offer={offer} />
    </>
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

export function ProjectCreationPage(props: {
  readonly workspace?: string | undefined;
}): ReactNode {
  return (
    <ProjectlessFrame>
      <ProjectCreation
        workspace={props.workspace}
        lead={<h1 className="text-md font-strong text-ink-1">New project</h1>}
      />
    </ProjectlessFrame>
  );
}
