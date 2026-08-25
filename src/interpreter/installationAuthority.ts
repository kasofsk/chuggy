import type { InstallationId } from "../domain/ids.ts";

/** The one durable authority identity restored with the canonical journal. */
export interface InstallationAuthorityRead {
  installationAuthority(): Promise<InstallationId>;
}
