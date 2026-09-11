/**
 * An account a tenant claimed a forge app on is a row, and the tokens minted
 * under it are the credential for every repository that account owns.
 *
 * AN ACCOUNT BELONGS TO ONE TENANT, AND THAT IS THE WHOLE OF THE UNIQUENESS.
 * The key is the forge, the app and the account; the tenant is a column,
 * because making it part of the key is exactly what would let two tenants claim
 * one account and mint for each other's repositories. `ClaimedElsewhere` is the
 * door saying so rather than a constraint raising where an outcome belongs.
 *
 * A REINSTALL IS AN UPDATE AND NOT A SECOND ROW. A forge gives a new
 * installation identity when an app is removed and installed again, so the
 * claim that already stands is moved onto it; the tenant, the account and the
 * app it was claimed for cannot move at all, which
 * `forge_installation_keeps_its_claim` refuses even from the owner.
 *
 * THE AUTHORITY IS THE AUDITED ONE AND AUTHORIZES NOTHING. It records who
 * acted, as every other audited row does, and no read consults it: what a
 * principal may do is the relation authority's, and a column here would be a
 * second answer to a question this tree stopped asking a database in 083.
 *
 * EXECUTE IS THE OWNER'S ALONE IN THIS SLICE. The only writer is the
 * provisioning root, which connects as the owner; the API is granted the read
 * it mints from and no more, and the grant that lets a route claim an
 * installation arrives with the route.
 */

import {
  authorityCharsMax,
  operationIdentityCharsMax,
} from "../../../../interpreter/operationInbox.ts";
import { finalizerIdentityCharsMax } from "../../../../interpreter/finalizer.ts";
import {
  allForgeAccountKinds,
  allForgeApps,
} from "../../../../interpreter/forgeInstallation.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  forgeInstallationRecordFunction,
  schedulerRole,
  schemaTextSet,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const installations = [
  `CREATE TABLE forge_installation (
     forge             text NOT NULL,
     app               text NOT NULL,
     account           text NOT NULL,
     account_kind      text NOT NULL,
     installation_id   text NOT NULL,
     tenant            text NOT NULL,
     authority_kind    text NOT NULL,
     authority_subject text NOT NULL,
     claimed_at        timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (forge, app, account),
     CONSTRAINT forge_installation_app_is_known CHECK (
       app IN (${schemaTextSet([...allForgeApps])})),
     CONSTRAINT forge_installation_account_kind_is_known CHECK (
       account_kind IN (${schemaTextSet([...allForgeAccountKinds])})),
     CONSTRAINT forge_installation_is_bounded CHECK (
       length(forge) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(account) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(installation_id) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(tenant) BETWEEN 1 AND ${operationIdentityCharsMax}
       AND length(authority_kind) BETWEEN 1 AND ${authorityCharsMax}
       AND length(authority_subject) BETWEEN 1 AND ${authorityCharsMax})
   )`,
  `CREATE FUNCTION forge_installation_keeps_its_claim() RETURNS trigger
     LANGUAGE plpgsql AS $$ BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'a forge installation claim is not released'
         USING ERRCODE='integrity_constraint_violation';
     END IF;
     IF NEW.forge IS DISTINCT FROM OLD.forge
        OR NEW.app IS DISTINCT FROM OLD.app
        OR NEW.account IS DISTINCT FROM OLD.account
        OR NEW.tenant IS DISTINCT FROM OLD.tenant THEN
       RAISE EXCEPTION 'a forge installation does not change hands'
         USING ERRCODE='integrity_constraint_violation';
     END IF;
     RETURN NEW; END $$`,
  `ALTER FUNCTION forge_installation_keeps_its_claim() OWNER TO ${boundaryOwnerRole}`,
  `CREATE TRIGGER forge_installation_keeps_its_claim
     BEFORE UPDATE OR DELETE ON forge_installation
     FOR EACH ROW EXECUTE FUNCTION forge_installation_keeps_its_claim()`,
  `GRANT SELECT,INSERT,UPDATE ON forge_installation TO ${boundaryOwnerRole}`,
  `GRANT SELECT ON forge_installation TO ${apiRole}`,
  `REVOKE ALL ON forge_installation
     FROM ${ticketServiceRole},${selectorServiceRole},${schedulerRole},
          ${workerPlaneRole},${finalizerRole},${configurationImporterRole}`,
];

/**
 * The owner's door onto a claim. The account lock is what serialises two
 * claims of one account, so the uniqueness above raises nowhere an outcome
 * string belongs.
 */
const claimDoor = [
  `CREATE FUNCTION ${forgeInstallationRecordFunction}(
     in_forge text,in_app text,in_account text,in_account_kind text,
     in_installation_id text,in_tenant text,
     in_authority_kind text,in_authority_subject text)
     RETURNS text LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE existing forge_installation%ROWTYPE;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended(
       format('forge-installation:%L/%L/%L',in_forge,in_app,in_account),0));
     SELECT * INTO existing FROM forge_installation
      WHERE forge=in_forge AND app=in_app AND account=in_account;
     IF NOT FOUND THEN
       INSERT INTO forge_installation
         (forge,app,account,account_kind,installation_id,tenant,
          authority_kind,authority_subject)
         VALUES(in_forge,in_app,in_account,in_account_kind,in_installation_id,
                in_tenant,in_authority_kind,in_authority_subject);
       RETURN 'Recorded';
     END IF;
     IF existing.tenant<>in_tenant THEN RETURN 'ClaimedElsewhere'; END IF;
     IF existing.installation_id=in_installation_id
        AND existing.account_kind=in_account_kind
       THEN RETURN 'AlreadyRecorded'; END IF;
     UPDATE forge_installation
        SET installation_id=in_installation_id,account_kind=in_account_kind,
            authority_kind=in_authority_kind,authority_subject=in_authority_subject,
            claimed_at=now()
      WHERE forge=in_forge AND app=in_app AND account=in_account;
     RETURN 'Reinstalled';
   END $$`,
  `ALTER FUNCTION ${forgeInstallationRecordFunction}(text,text,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${forgeInstallationRecordFunction}(text,text,text,text,text,text,text,text)
     FROM PUBLIC`,
];

/** Which tenant may mint for an account is a row here, and a claim is never reassigned. */
export const migration084: Migration = {
  version: 84,
  name: "forge installations are claimed accounts",
  statements: [...installations, ...claimDoor],
};
