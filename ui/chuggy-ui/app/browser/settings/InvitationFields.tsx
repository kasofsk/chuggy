/**
 * The fields an invitation names a person by, the same in every form that
 * invites one: a labelled line with its fault under it before anything is
 * sent, the email and the GitHub username each held to the contract's schema,
 * and under the username the line a reader who may make no account is told.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import {
  tenantInvitationAccountLine,
  tenantInvitationEmailFault,
  tenantInvitationGithubFault,
} from "../../core/tenantPeople.ts";
import { Input } from "../ui/Input.tsx";

export const invitationLabelClassName = "text-sm font-medium text-ink-3";

export function InvitationFault(props: {
  readonly id?: string;
  readonly fault: string | undefined;
}): ReactNode {
  return (
    <span id={props.id} className="text-xs text-tone-fail">
      {props.fault}
    </span>
  );
}

export function InvitationText(props: {
  readonly label: string;
  readonly value: string;
  readonly fault: string | undefined;
  readonly line?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const faultId = useId();
  return (
    <label className={`grid gap-1 ${invitationLabelClassName}`}>
      {props.label}
      <Input
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        invalid={props.fault !== undefined}
        disabled={props.disabled}
        describedBy={faultId}
      />
      <InvitationFault id={faultId} fault={props.fault} />
      {props.line === undefined ? null : (
        <span className="text-xs font-regular">{props.line}</span>
      )}
    </label>
  );
}

/** What a field of the person's is given by the form that holds it. */
interface InvitationField {
  readonly value: string;
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => void;
}

export function InvitationEmail(props: InvitationField): ReactNode {
  return (
    <InvitationText
      label="Email"
      fault={tenantInvitationEmailFault(props.value)}
      {...props}
    />
  );
}

export function InvitationGithub(
  props: InvitationField & {
    /** The reader's abilities where the invitation is made, a workspace's or the site's. */
    readonly abilities: { readonly createAccount: boolean } | undefined;
  },
): ReactNode {
  const { abilities, ...field } = props;
  return (
    <InvitationText
      label="GitHub username"
      fault={tenantInvitationGithubFault(field.value)}
      line={tenantInvitationAccountLine(abilities)}
      {...field}
    />
  );
}
