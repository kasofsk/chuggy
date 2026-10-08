/**
 * One person's roles and hosted runs, changed in the dialog their row's Edit
 * opens: a box for each workspace role and for hosted runs, and the
 * workspace's projects as a grid. A box is drawn where the reader may change
 * it or the person holds it, and is pressable only where the reader may. A
 * press sends one grant or one removal and reads the list and the abilities
 * again, the pressed box drawn as the change will leave it until they are
 * read, and a refusal is one line in the dialog. Removing the reader's own
 * workspace admin, and hosted runs from a subject that is no account, is asked
 * first, and no box is pressable while it is.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessTenantAbilities,
  AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  apiGrantHostedRuns,
  apiGrantProjectRole,
  apiGrantTenantRole,
  apiRemoveHostedRuns,
  apiRemoveProjectRole,
  apiRemoveTenantRole,
} from "../../core/accessRoutes.ts";
import {
  tenantPersonBoxChecked,
  tenantPersonChangeAsks,
  tenantPersonChangeNote,
  tenantPersonName,
  tenantPersonProjectBox,
  tenantPersonProjectDrawn,
  tenantPersonQuestion,
  tenantPersonWorkspaceBoxes,
} from "../../core/tenantPeople.ts";
import type {
  TenantPersonBox,
  TenantPersonChange,
} from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";
import { TenantProjectsGrid } from "./TenantProjectsGrid.tsx";

function tenantPersonChangeSent(
  ports: ApiPorts,
  tenant: string,
  subject: string,
  change: TenantPersonChange,
): Promise<ApiResult<undefined>> {
  if (change.scope === "HostedRuns")
    return change.held
      ? apiRemoveHostedRuns(ports, tenant, subject)
      : apiGrantHostedRuns(ports, tenant, subject);
  if (change.scope === "Tenant")
    return change.held
      ? apiRemoveTenantRole(ports, tenant, subject, change.role)
      : apiGrantTenantRole(ports, tenant, subject, change.role);
  return change.held
    ? apiRemoveProjectRole(ports, tenant, change.project, subject, change.role)
    : apiGrantProjectRole(ports, tenant, change.project, subject, change.role);
}

interface TenantPersonChanging {
  /** The change the list has not yet caught up with. */
  readonly sending: TenantPersonChange | undefined;
  /** Its request is unanswered. */
  readonly unanswered: boolean;
  readonly note: string | undefined;
  readonly asking: TenantPersonChange | undefined;
  /** The editor opening: nothing asked and nothing said yet. */
  readonly begin: () => void;
  readonly press: (change: TenantPersonChange) => void;
  readonly send: (change: TenantPersonChange) => void;
  readonly cancel: () => void;
}

/** One change at a time for one person, from the press to the line it leaves. */
function useTenantPersonChange(
  tenant: string,
  person: AccessTenantPerson,
): TenantPersonChanging {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [sending, setSending] = useState<TenantPersonChange | undefined>(
    undefined,
  );
  const [unanswered, setUnanswered] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState<TenantPersonChange | undefined>(
    undefined,
  );
  const send = (change: TenantPersonChange): void => {
    setSending(change);
    setUnanswered(true);
    setNote(undefined);
    void (async () => {
      const answered = await tenantPersonChangeSent(
        ports,
        tenant,
        person.subject,
        change,
      );
      const refused = tenantPersonChangeNote(answered);
      setUnanswered(false);
      setAsking(undefined);
      setNote(refused);
      if (refused !== undefined) {
        setSending(undefined);
        void tenantPeopleReread(client, tenant);
        return;
      }
      await tenantPeopleReread(client, tenant);
      setSending(undefined);
    })();
  };
  return {
    sending,
    unanswered,
    note,
    asking,
    send,
    begin: () => {
      setAsking(undefined);
      setNote(undefined);
    },
    press: (change) => {
      if (tenantPersonChangeAsks(person, change)) setAsking(change);
      else send(change);
    },
    cancel: () => {
      setAsking(undefined);
    },
  };
}

/** No box takes a press while a change is asked about or being sent. */
function tenantPersonChangeHeld(changing: TenantPersonChanging): boolean {
  return changing.asking !== undefined || changing.sending !== undefined;
}

function TenantPersonWorkspace(props: {
  readonly boxes: readonly TenantPersonBox[];
  readonly changing: TenantPersonChanging;
}): ReactNode {
  const labelled = useId();
  const changing = props.changing;
  if (props.boxes.length === 0) return null;
  return (
    <div role="group" aria-labelledby={labelled} className="grid gap-2">
      <span id={labelled} className="text-sm text-ink-3">
        Workspace
      </span>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {props.boxes.map((box) => (
          <Checkbox
            key={box.label}
            label={box.label}
            checked={tenantPersonBoxChecked(box, changing.sending)}
            disabled={!box.offered}
            held={tenantPersonChangeHeld(changing)}
            onChange={() => {
              changing.press(box.change);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TenantPersonAsked(props: {
  readonly changing: TenantPersonChanging;
}): ReactNode {
  const changing = props.changing;
  const asking = changing.asking;
  if (asking === undefined) return null;
  const asked = tenantPersonQuestion(asking);
  return (
    <Confirm
      question={asked.question}
      confirm="Remove"
      busy={changing.sending !== undefined}
      onConfirm={() => {
        changing.send(asking);
      }}
      onCancel={changing.cancel}
    >
      {asked.line}
    </Confirm>
  );
}

function TenantPersonEditorBody(props: {
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
  readonly changing: TenantPersonChanging;
}): ReactNode {
  const { person, abilities, changing } = props;
  return (
    <div className="grid gap-5" aria-busy={changing.sending !== undefined}>
      <TenantPersonWorkspace
        boxes={tenantPersonWorkspaceBoxes(abilities, person)}
        changing={changing}
      />
      <TenantPersonAsked changing={changing} />
      <TenantProjectsGrid
        projects={props.projects.filter((project) =>
          tenantPersonProjectDrawn(abilities, person, project),
        )}
        box={(project, role) => {
          const box = tenantPersonProjectBox(abilities, person, project, role);
          if (box === undefined) return undefined;
          return {
            checked: tenantPersonBoxChecked(box, changing.sending),
            disabled: !box.offered,
            held: tenantPersonChangeHeld(changing),
          };
        }}
        onToggle={(project, role) => {
          const box = tenantPersonProjectBox(abilities, person, project, role);
          if (box !== undefined) changing.press(box.change);
        }}
      />
    </div>
  );
}

/** The Edit in a person's row and the dialog it opens, named for the person
 * so one Edit is told from the next by more than where it stands. */
export function TenantPersonEditor(props: {
  readonly tenant: string;
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const changing = useTenantPersonChange(props.tenant, props.person);
  const name = tenantPersonName(props.person).name;
  const busy = changing.unanswered;
  return (
    <Dialog
      wide
      title={name}
      trigger="Edit"
      triggerNamed={`Edit ${name}`}
      triggerVariant="quiet"
      open={open}
      onOpenChange={(opened) => {
        if (opened) changing.begin();
        setOpen(opened);
      }}
      busy={busy}
      note={changing.note}
      foot={
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
          }}
        >
          Done
        </Button>
      }
    >
      <TenantPersonEditorBody
        person={props.person}
        projects={props.projects}
        abilities={props.abilities}
        changing={changing}
      />
    </Dialog>
  );
}
