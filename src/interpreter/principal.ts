/**
 * Who a request is, standing apart from the boundary that authenticates one so
 * that a vocabulary recording a subject need not depend on the whole
 * application boundary. `./nativeWeb.ts` re-exports all three, the way it
 * already re-exports `./publicResource.ts`, so no caller sees the difference.
 */

import { principalCharsMax } from "../contract/http.ts";
import { asBoundedText } from "./boundedText.ts";

declare const principalBrand: unique symbol;

/** An authenticated session subject, opaque to the application boundary. */
export type Principal = string & { readonly [principalBrand]: true };

export { principalCharsMax };

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

/**
 * The subject `principal` carries under `issuer`, or nothing where it was
 * derived under another issuer. The length that leads a principal fixes where
 * its issuer ends, so beginning with this issuer's own prefix is an exact test.
 */
export function oidcPrincipalSubject(
  issuer: string,
  principal: string,
): string | undefined {
  const prefix = `${String(issuer.length)}:${issuer}`;
  return principal.startsWith(prefix) && principal.length > prefix.length
    ? principal.slice(prefix.length)
    : undefined;
}
