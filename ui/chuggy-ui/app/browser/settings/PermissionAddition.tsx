/**
 * Adding one holder to one permission: a dialog offering what the row is
 * given, one choice at a time, and for a person a roster of the people given
 * to choose among, each drawn as the People page draws them. What adding does
 * is its caller's; the dialog holds the choice, closes on an addition the
 * plane took, and leaves a refusal's one line beside what was chosen.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { AccessAuthorityPerson } from "../../../../../src/contract/accessPlane.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import {
  permissionChoiceHolder,
  permissionChoiceValue,
  type PermissionAuthority,
  type PermissionChoice,
  type PermissionHolder,
  type PermissionRow,
} from "../../core/permissions.ts";
import {
  accessFailureLabel,
  tenantPersonName,
} from "../../core/tenantPeople.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Notice } from "../ui/Notice.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SearchableRoster } from "../ui/SearchableRoster.tsx";
import { TenantPersonWho } from "./TenantPersonRow.tsx";

/** Whether a row may be given a holder, what it offers, the people to choose
 * among, and what adding one does. */
export interface PermissionsAddition<Authority extends PermissionAuthority> {
  readonly addable: (row: PermissionRow<Authority>) => boolean;
  readonly choices: (
    row: PermissionRow<Authority>,
  ) => readonly PermissionChoice[];
  readonly people: (
    row: PermissionRow<Authority>,
  ) => readonly AccessAuthorityPerson[];
  readonly add: (
    row: PermissionRow<Authority>,
    holder: PermissionHolder,
  ) => Promise<ApiResult<undefined>>;
}

/** One addition, from the press to the dialog closing or the line it leaves. */
function usePermissionAdding(
  add: (holder: PermissionHolder) => Promise<ApiResult<undefined>>,
  onAdded: () => void,
): {
  readonly busy: boolean;
  readonly note: string | undefined;
  readonly send: (holder: PermissionHolder) => void;
} {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  return {
    busy,
    note,
    send: (holder) => {
      setBusy(true);
      setNote(undefined);
      void (async () => {
        const answered = await add(holder);
        setBusy(false);
        if (answered.outcome === "Ok") onAdded();
        else setNote(accessFailureLabel(answered));
      })();
    },
  };
}

function PermissionAdditionPerson(props: {
  readonly people: readonly AccessAuthorityPerson[];
  readonly chosen: AccessAuthorityPerson | undefined;
  readonly onChoose: (person: AccessAuthorityPerson) => void;
}): ReactNode {
  return (
    <SearchableRoster
      label="Filter"
      rows={props.people}
      textOf={(person) => {
        const named = tenantPersonName(person);
        return `${named.name} ${named.githubLogin ?? ""}`;
      }}
      keyOf={(person) => person.subject}
      renderRow={(person) => (
        <span className="flex flex-wrap items-center gap-2">
          <TenantPersonWho person={person} />
          <Button
            size="sm"
            variant="quiet"
            pressed={props.chosen?.subject === person.subject}
            onClick={() => {
              props.onChoose(person);
            }}
          >
            Choose{" "}
            <span className="visually-hidden">
              {tenantPersonName(person).name}
            </span>
          </Button>
        </span>
      )}
    />
  );
}

function PermissionAdditionBody(props: {
  readonly choices: readonly PermissionChoice[];
  readonly people: readonly AccessAuthorityPerson[];
  readonly add: (holder: PermissionHolder) => Promise<ApiResult<undefined>>;
  readonly onAdded: () => void;
}): ReactNode {
  const [choice, setChoice] = useState<PermissionChoice | undefined>(undefined);
  const [person, setPerson] = useState<AccessAuthorityPerson | undefined>(
    undefined,
  );
  const adding = usePermissionAdding(props.add, props.onAdded);
  const holder = permissionChoiceHolder(choice, person);
  if (props.choices.length === 0)
    return <EmptyState variant="inline" label="Nothing to add" />;
  return (
    <div className="grid min-h-0 gap-3">
      <RadioGroup
        label="Holder"
        value={choice === undefined ? "" : permissionChoiceValue(choice)}
        options={props.choices.map((offered) => ({
          value: permissionChoiceValue(offered),
          text: offered.words,
          ...(offered.line === undefined ? {} : { description: offered.line }),
        }))}
        onChoose={(value) => {
          setChoice(
            props.choices.find(
              (offered) => permissionChoiceValue(offered) === value,
            ),
          );
        }}
      />
      {choice?.kind === "Person" ? (
        <PermissionAdditionPerson
          people={props.people}
          chosen={person}
          onChoose={setPerson}
        />
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={holder === undefined || adding.busy}
          busy={adding.busy}
          onClick={() => {
            if (holder !== undefined) adding.send(holder);
          }}
        >
          Add
        </Button>
        {adding.note === undefined ? null : (
          <Notice tone="danger" inline role="status" detail={adding.note} />
        )}
      </div>
    </div>
  );
}

export function PermissionAddition<
  Authority extends PermissionAuthority,
>(props: {
  readonly row: PermissionRow<Authority>;
  readonly addition: PermissionsAddition<Authority>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const row = props.row;
  const addition = props.addition;
  return (
    <Dialog
      title="Add holder"
      trigger={
        <>
          Add <span className="visually-hidden">{`to ${row.name}`}</span>
        </>
      }
      triggerVariant="quiet"
      open={open}
      onOpenChange={setOpen}
    >
      <PermissionAdditionBody
        choices={addition.choices(row)}
        people={addition.people(row)}
        add={(holder) => addition.add(row, holder)}
        onAdded={() => {
          setOpen(false);
        }}
      />
    </Dialog>
  );
}
