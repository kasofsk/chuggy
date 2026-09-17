import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketServiceRole,
} from "./shared.ts";

const acceptanceSignature = "text,text,text,text,text,text,text";
const wrapperSignature = "text,text,text,text,text,text";
const origins = [
  ["author", "Author", apiRole],
  ["execution", "Execution", schedulerRole],
  ["finalizer", "Finalizer", finalizerRole],
] as const;

export const ticketMachineQueueStatements: readonly string[] = [
  `CREATE TABLE ticket_machine_submission (
    tenant text NOT NULL, project text NOT NULL, identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 256),
    ordinal bigint NOT NULL CHECK(ordinal>0), origin text NOT NULL CHECK(origin IN ('Author','Execution','Finalizer')),
    command text NOT NULL CHECK(octet_length(command)<=1048576), attribution text NOT NULL CHECK(jsonb_typeof(attribution::jsonb)='object'),
    metadata text, PRIMARY KEY(tenant,project,identity), UNIQUE(tenant,project,ordinal),
    FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
  `CREATE TABLE ticket_machine_reservation (
    tenant text NOT NULL, project text NOT NULL, identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 256),
    ticket bigint GENERATED ALWAYS AS IDENTITY CHECK(ticket BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY(tenant,project,identity), UNIQUE(tenant,project,ticket),
    FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
  `CREATE TABLE ticket_machine_release (
    tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL, metadata text NOT NULL,
    PRIMARY KEY(tenant,project,ticket), FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
  `GRANT SELECT,INSERT ON ticket_machine_submission,ticket_machine_reservation TO ${boundaryOwnerRole}`,
  `GRANT USAGE ON SEQUENCE ticket_machine_reservation_ticket_seq TO ${boundaryOwnerRole}`,
  `GRANT SELECT ON ticket_machine_submission,ticket_machine_reservation,ticket_machine_release,ticket_machine_input TO ${apiRole},${ticketServiceRole},${boundaryOwnerRole}`,
  `GRANT SELECT,INSERT,UPDATE ON ticket_machine_release TO ${ticketServiceRole}`,
  `CREATE FUNCTION accept_ticket_machine_input(p_tenant text,p_project text,p_identity text,p_origin text,p_command text,p_authorization text,p_metadata text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE held project%ROWTYPE; prior ticket_machine_submission%ROWTYPE; pending bigint; next_ordinal bigint;
    BEGIN
      SELECT * INTO held FROM project WHERE tenant=p_tenant AND project=p_project FOR UPDATE;
      IF NOT FOUND THEN RETURN 'ProjectNotFound'; END IF;
      IF held.ticket_model<>'Chuggernaut' THEN RETURN 'LegacyModelUnsupported'; END IF;
      SELECT * INTO prior FROM ticket_machine_submission WHERE tenant=p_tenant AND project=p_project AND identity=p_identity;
      IF FOUND THEN
        IF prior.origin=p_origin AND prior.command=p_command AND prior.attribution=p_authorization AND prior.metadata IS NOT DISTINCT FROM p_metadata THEN RETURN 'AlreadyAccepted'; END IF;
        RETURN 'InputConflict';
      END IF;
      IF held.lifecycle<>'Active' THEN RETURN 'ProjectNotActive'; END IF;
      SELECT count(*) INTO pending FROM ticket_machine_submission s WHERE s.tenant=p_tenant AND s.project=p_project
        AND NOT EXISTS(SELECT 1 FROM ticket_machine_input i WHERE i.tenant=s.tenant AND i.project=s.project AND i.identity=s.identity);
      IF pending>=1250 OR (p_origin='Author' AND pending>=1000) THEN RETURN 'Backpressure'; END IF;
      SELECT COALESCE(MAX(ordinal),0)+1 INTO next_ordinal FROM ticket_machine_submission WHERE tenant=p_tenant AND project=p_project;
      INSERT INTO ticket_machine_submission(tenant,project,identity,ordinal,origin,command,attribution,metadata)
        VALUES(p_tenant,p_project,p_identity,next_ordinal,p_origin,p_command,p_authorization,p_metadata);
      RETURN 'Accepted';
    END $$`,
  `ALTER FUNCTION accept_ticket_machine_input(${acceptanceSignature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION accept_ticket_machine_input(${acceptanceSignature}) FROM PUBLIC`,
  ...origins.flatMap(([name, origin, role]) => [
    `CREATE FUNCTION accept_ticket_${name}_input(p_tenant text,p_project text,p_identity text,p_command text,p_authorization text,p_metadata text)
      RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      SELECT accept_ticket_machine_input(p_tenant,p_project,p_identity,'${origin}',p_command,p_authorization,p_metadata) $$`,
    `ALTER FUNCTION accept_ticket_${name}_input(${wrapperSignature}) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION accept_ticket_${name}_input(${wrapperSignature}) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION accept_ticket_${name}_input(${wrapperSignature}) TO ${role},${ticketServiceRole}`,
  ]),
  `CREATE FUNCTION reserve_ticket_machine_identity(p_tenant text,p_project text,p_identity text)
    RETURNS TABLE(reserved text,ticket text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE held project%ROWTYPE; found_ticket bigint;
    BEGIN
      SELECT * INTO held FROM project WHERE tenant=p_tenant AND project=p_project FOR UPDATE;
      IF NOT FOUND THEN RETURN QUERY SELECT 'ProjectNotFound'::text,NULL::text; RETURN; END IF;
      IF held.ticket_model<>'Chuggernaut' THEN RETURN QUERY SELECT 'LegacyModelUnsupported'::text,NULL::text; RETURN; END IF;
      IF held.lifecycle<>'Active' THEN RETURN QUERY SELECT 'ProjectNotActive'::text,NULL::text; RETURN; END IF;
      INSERT INTO ticket_machine_reservation(tenant,project,identity) VALUES(p_tenant,p_project,p_identity) ON CONFLICT DO NOTHING;
      SELECT r.ticket INTO found_ticket FROM ticket_machine_reservation r WHERE r.tenant=p_tenant AND r.project=p_project AND r.identity=p_identity;
      RETURN QUERY SELECT 'Reserved'::text,found_ticket::text;
    END $$`,
  `ALTER FUNCTION reserve_ticket_machine_identity(text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION reserve_ticket_machine_identity(text,text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION reserve_ticket_machine_identity(text,text,text) TO ${apiRole},${ticketServiceRole}`,
];
