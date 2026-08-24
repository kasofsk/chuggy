import {
  apiRole,
  boundaryOwnerRole,
  notificationPublishFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const durableNotifications = [
  `ALTER TABLE project ADD COLUMN notification_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_notification_next_is_positive CHECK (notification_next >= 1)`,
  `CREATE TABLE project_notification (
     tenant text NOT NULL, project text NOT NULL, ordinal bigint NOT NULL,
     kind text NOT NULL, resource text NOT NULL, project_seq bigint,
     authoring_version bigint, created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,ordinal),
     CONSTRAINT project_notification_belongs_to_project FOREIGN KEY (tenant,project)
       REFERENCES project (tenant,project),
     CONSTRAINT project_notification_kind_is_known CHECK
       (kind IN ('Operation','Ticket','Draft','Configuration')),
     CONSTRAINT project_notification_values_are_bounded CHECK
       (ordinal >= 1 AND length(resource) BETWEEN 1 AND 256
        AND coalesce(project_seq,1) >= 1 AND coalesce(authoring_version,1) >= 1)
   )`,
  `CREATE FUNCTION ${notificationPublishFunction}(in_tenant text,in_project text,in_kind text,
      in_resource text,in_project_seq bigint,in_authoring_version bigint) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE allocated bigint; retention_max constant bigint := 1000;
     BEGIN
       UPDATE project SET notification_next=notification_next+1
        WHERE tenant=in_tenant AND project=in_project
        RETURNING notification_next-1 INTO allocated;
       IF allocated IS NULL THEN RAISE EXCEPTION 'notification project is absent'; END IF;
       INSERT INTO project_notification
         (tenant,project,ordinal,kind,resource,project_seq,authoring_version)
       VALUES (in_tenant,in_project,allocated,in_kind,in_resource,in_project_seq,in_authoring_version);
       DELETE FROM project_notification
        WHERE tenant=in_tenant AND project=in_project AND ordinal <= allocated-retention_max;
       RETURN allocated;
     END $$`,
  `ALTER FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) FROM PUBLIC`,
  `GRANT SELECT,INSERT,DELETE ON project_notification TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (notification_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint)
     TO ${ticketServiceRole}`,
  `GRANT SELECT ON project_notification TO ${apiRole}`,
];

export const migration008: Migration = {
  version: 8,
  name: "bounded durable project notifications",
  statements: [...durableNotifications],
};
