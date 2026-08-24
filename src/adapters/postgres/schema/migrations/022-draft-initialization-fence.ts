import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  notificationPublishFunction,
  type Migration,
} from "../shared.ts";

export const migration022: Migration = {
  version: 22,
  name: "draft initialization fence",
  statements: [
    `DROP FUNCTION ${draftCreateFunction}(text,text,text,text,text,text)`,
    `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
        in_configuration_digest text,in_expected_head bigint,in_authoring text,in_kind text,in_subject text)
       RETURNS TABLE(result text,ticket bigint,authoring_version bigint,state text)
       LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       DECLARE minted bigint;
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
              AND revision=in_configuration AND digest=in_configuration_digest)
           THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
         UPDATE project SET ticket_next=ticket_next+1
          WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active' AND head=in_expected_head
          RETURNING ticket_next-1 INTO minted;
         IF minted IS NULL THEN RETURN QUERY SELECT 'Stale',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
         INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
         INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
           VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
         PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
         RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
       END $$`,
    `ALTER FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text) TO ${apiRole}`,
  ],
};
