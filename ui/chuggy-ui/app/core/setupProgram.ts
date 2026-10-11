/**
 * The setup program's fixed facts: the path the console serves it at, the
 * client it signs in as, the loopback address a sign-in returns to, and the
 * Node it runs on.
 *
 * The path is read by the build that emits the program, so the file's name and
 * its address are one constant. This module imports nothing, because the
 * program reads it before it knows the Node under it can run anything else.
 */

export const setupProgramPath = "/chuggy-setup.mjs";
export const setupClientId = "chuggy-setup";
export const setupCallbackPath = "/callback";
export const setupScopes: readonly string[] = ["openid", "offline_access"];
export const setupNodeMajorMin = 24;

/** The address itself and never a name for it: the issuer matches a redirect's host exactly. */
export const setupLoopbackHost = "127.0.0.1";

/** The major version a Node reports, or nothing where the text is not a version. */
export function setupNodeMajor(version: string): number | undefined {
  const major = /^(\d+)\./u.exec(version)?.[1];
  return major === undefined ? undefined : Number(major);
}

export function setupNodeAccepted(version: string): boolean {
  const major = setupNodeMajor(version);
  return major !== undefined && major >= setupNodeMajorMin;
}

/** Where a person's browser reaches the program's listener on this machine. */
export function setupLoopbackAddress(port: number): string {
  return `http://${setupLoopbackHost}:${String(port)}/`;
}

/** The redirect a sign-in names: the listener's own port, or the registered address where no answer is awaited. */
export function setupRedirectUri(port: number | undefined): string {
  const authority =
    port === undefined
      ? setupLoopbackHost
      : `${setupLoopbackHost}:${String(port)}`;
  return `http://${authority}${setupCallbackPath}`;
}
