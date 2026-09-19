import { asBoundedText } from "./boundedText.ts";
import { principalCharsMax } from "./principal.ts";

declare const operationIdBrand: unique symbol;
declare const authorityKindBrand: unique symbol;
declare const authoritySubjectBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

export type OperationId = string & { readonly [operationIdBrand]: true };
export type AuthorityKind = string & { readonly [authorityKindBrand]: true };
export type AuthoritySubject = string & {
  readonly [authoritySubjectBrand]: true;
};
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

export const operationIdentityCharsMax = 256;
export const idempotencyKeyCharsMax = 256;
export const authorityCharsMax = principalCharsMax;

export function asOperationId(value: string): OperationId {
  return asBoundedText(
    value,
    "operation id",
    operationIdentityCharsMax,
  ) as OperationId;
}

export function asAuthorityKind(value: string): AuthorityKind {
  return asBoundedText(
    value,
    "authority kind",
    authorityCharsMax,
  ) as AuthorityKind;
}

export function asAuthoritySubject(value: string): AuthoritySubject {
  return asBoundedText(
    value,
    "authority subject",
    authorityCharsMax,
  ) as AuthoritySubject;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
  return asBoundedText(
    value.normalize("NFC"),
    "idempotency key",
    idempotencyKeyCharsMax,
  ) as IdempotencyKey;
}

export interface Authority {
  readonly kind: AuthorityKind;
  readonly subject: AuthoritySubject;
}
