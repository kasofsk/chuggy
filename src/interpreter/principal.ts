/**
 * Who a request is, standing apart from the boundary that authenticates one so
 * that a vocabulary recording a subject need not depend on the whole
 * application boundary. `./nativeWeb.ts` re-exports all three, the way it
 * already re-exports `./publicResource.ts`, so no caller sees the difference.
 */

import { asBoundedText } from "./boundedText.ts";

declare const principalBrand: unique symbol;

/** An authenticated session subject, opaque to the application boundary. */
export type Principal = string & { readonly [principalBrand]: true };

/**
 * The longest principal a stored row holds, which `./operationInbox.ts` bounds
 * an audited authority by rather than declaring a second number. Project
 * access derives one from the other, so a principal wider than the column that
 * records what it submitted is refused where it is composed.
 */
export const principalCharsMax = 256;

/** Brands a bounded principal. */
export function asPrincipal(value: string): Principal {
  return asBoundedText(value, "principal", principalCharsMax) as Principal;
}

/**
 * The principal an OIDC identity resolves to, length-prefixing the issuer so
 * that no issuer and subject pair encodes to the same string as another's.
 * Every side that names an identity derives it here.
 */
export function oidcPrincipal(issuer: string, subject: string): Principal {
  if (issuer.length === 0) throw new RangeError("OIDC issuer is empty");
  if (subject.length === 0) throw new RangeError("OIDC subject is empty");
  return asPrincipal(`${String(issuer.length)}:${issuer}${subject}`);
}
