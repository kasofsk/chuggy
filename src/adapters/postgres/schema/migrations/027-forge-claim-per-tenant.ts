import { forgeInstallationRecordFunction, type Migration } from "../shared.ts";

/**
 * A forge account's claim is each tenant's own, because a claim now needs proof
 * of ownership, which several tenants' administrators may each hold. Every row
 * stands as it was, and the door no longer answers `ClaimedElsewhere`.
 */
export const migration027: Migration = {
  version: 27,
  name: "a forge account's claim is each tenant's own",
  statements: [
    `ALTER TABLE public.forge_installation DROP CONSTRAINT forge_installation_pkey`,
    `ALTER TABLE public.forge_installation
       ADD CONSTRAINT forge_installation_pkey PRIMARY KEY (tenant, forge, app, account)`,
    `CREATE OR REPLACE FUNCTION public.${forgeInstallationRecordFunction}(in_forge text, in_app text, in_account text, in_account_kind text, in_installation_id text, in_tenant text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing forge_installation%ROWTYPE;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended(
       format('forge-installation:%L/%L/%L/%L',in_tenant,in_forge,in_app,in_account),0));
     SELECT * INTO existing FROM forge_installation
      WHERE tenant=in_tenant AND forge=in_forge AND app=in_app AND account=in_account;
     IF NOT FOUND THEN
       INSERT INTO forge_installation
         (forge,app,account,account_kind,installation_id,tenant,
          authority_kind,authority_subject)
         VALUES(in_forge,in_app,in_account,in_account_kind,in_installation_id,
                in_tenant,in_authority_kind,in_authority_subject);
       RETURN 'Recorded';
     END IF;
     IF existing.installation_id=in_installation_id
        AND existing.account_kind=in_account_kind
       THEN RETURN 'AlreadyRecorded'; END IF;
     UPDATE forge_installation
        SET installation_id=in_installation_id,account_kind=in_account_kind,
            authority_kind=in_authority_kind,authority_subject=in_authority_subject,
            claimed_at=now()
      WHERE tenant=in_tenant AND forge=in_forge AND app=in_app AND account=in_account;
     RETURN 'Reinstalled';
   END $$`,
  ],
};
