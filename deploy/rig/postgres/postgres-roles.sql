-- The identities a chuggy deployment owns, and the privileges no migration can
-- grant itself.
--
-- RUN AS A SUPERUSER, AGAINST THE TARGET DATABASE, ON POSTGRESQL 16 OR NEWER,
-- BEFORE ANYTHING MIGRATES. A role is cluster-wide and a schema grant is not,
-- so both halves below land only when the connection is to the database the
-- relations will live in. The version floor is not this file's syntax; it is
-- what makes the CREATEROLE argument below true, and it is argued there.
--
-- WHY THE MIGRATING IDENTITY IS NOT THE SUPERUSER, AND WHY THE REASON IS NOT
-- THE SECURITY DEFINER FUNCTIONS. Such a body runs with the privileges of the
-- function's OWNER rather than of whoever created it, and the migration hands
-- every one of them to chuggy_boundary_owner with ALTER FUNCTION ... OWNER TO,
-- so no migrating identity is left owning one — a superuser included. What it
-- is left owning is every relation and no function but the trigger bodies the
-- chain never hands over; test/postgres/privileges.test.ts asks the server for
-- both halves rather than reading the chain. The reason is the credential: it
-- is issued, stored and rotated beside the service passwords, and a superuser
-- is bounded by nothing the database it migrates can state — every other
-- database in the cluster and every role in it are in its reach, and so is the
-- host, by the route the next paragraph names. chuggy_owner reaches what it
-- created and the roles it was granted, and holds one attribute beyond
-- ownership.
--
-- WHY THAT ATTRIBUTE IS CREATEROLE. The migration creates its group roles
-- itself, and creating a role is not something owning an object confers. It is
-- kept even though this file leaves nothing for those statements to do: a
-- migration that adds a group role would otherwise fail at start-up on every
-- cluster where this file was not re-run first, which is a coupling between a
-- future migration and a deployment step that nothing checks. CREATEROLE is not
-- superuser, and that separation is what PostgreSQL 16 introduced. Before it a
-- CREATEROLE role could grant itself membership in any non-superuser role, and
-- `pg_execute_server_program` is one of those and is a shell as the server's
-- own OS user — which is also the route by which a superuser reaches the host.
-- On an older cluster chuggy_owner would be superuser-equivalent by a single
-- GRANT and the argument above would be false, not merely weaker.
--
-- WHY THE GROUP ROLES ARE CREATED HERE AS WELL. A membership grant needs the
-- group to exist, and a deployment issues credentials before the process that
-- migrates has ever started. Creation is check-then-act against pg_roles, the
-- same shape the migration uses and for the reason it states: a role is
-- cluster-wide, so a sibling database may have made it first.
--
-- WHY chuggy_owner IS A MEMBER OF EVERY GROUP. For the service groups it owns
-- the relations, so membership confers no privilege it did not already hold.
-- What it buys is SET ROLE, which is how the privilege suite asks the server
-- what each group role is refused.
--
-- chuggy_boundary_owner IS THE ONE THAT WIDENS IT, AND HAS TO. That role owns
-- every function the chain hands over and chuggy_owner owns none of them, so a
-- migration whose statement is a GRANT on one of them is granting on an object
-- it neither owns nor holds grant option for. Which of them is SECURITY
-- DEFINER does not enter it, and reading the rule that way would leave out the
-- case it was written for: the boundary owner holds ordinary bodies too, and
-- the grant the memberships below exist for is an EXECUTE on one of those —
-- project_capacity_account, which test/postgres/privileges.test.ts asks the
-- server to confirm is that role's and is no SECURITY DEFINER. PostgreSQL
-- answers such a GRANT with a hard error when the grantor holds nothing at all
-- on the object, and with a warning when it holds some privilege on it without
-- grant option — and the warning is the branch that hurts, because the
-- statement succeeds having granted nothing, the runner commits the ledger row
-- beside it, and the version is applied by every account anyone can query.
-- A grantor that inherits a privilege through any group it belongs to is on
-- that branch, which is where the memberships below put chuggy_owner.
-- Membership in the owner is what makes the grant land, and the migration
-- cannot take it for itself: granting a role needs admin option on it, which a
-- CREATEROLE role holds only over roles it created itself.
--
-- AND IT NEEDS CREATE ON THE SCHEMA, on top of the USAGE every group role gets
-- below. A migration hands it those functions with ALTER FUNCTION ... OWNER TO,
-- and PostgreSQL requires the receiving owner to hold CREATE on the schema the
-- object lives in — so without it the migration stops at the first such
-- statement under the migrating identity, on a database at any version. USAGE
-- is not what it replaces: a SECURITY DEFINER body runs as this role, and one
-- that lacked USAGE on public could not resolve the objects its pinned
-- search_path names. It widens nothing either: chuggy_owner is its only member
-- and already holds CREATE, and the functions it owns create no objects.
--
-- PASSWORDS COME FROM THE ENVIRONMENT, so none of them is in this file and none
-- is in an argument list either — an argument to psql is in the process table
-- for anyone on the host to read, and a deployment secret has no business
-- there. Every way of failing to supply one is closed: an unset variable leaves
-- \getenv's target unset, the reference is left uninterpolated, and its
-- statement is a syntax error. An empty one makes PostgreSQL clear the password
-- rather than set one, leaving a role that cannot authenticate.
--
-- THE WHOLE FILE IS ONE TRANSACTION, which is what makes the first of those
-- safe rather than merely loud. psql is autocommit, so an abort partway would
-- otherwise leave the roles named before the failure rotated and the rest as
-- they were — a half-rotated cluster nobody asked for. Every statement here is
-- transactional, roles and grants included.
--
-- IDEMPOTENT, AND AUTHORITATIVE ABOUT ATTRIBUTES. Creation is conditional, the
-- ALTER statements restate every attribute ALTER ROLE can set rather than the
-- ones being changed, and a repeated grant is a no-op. Re-running it rotates
-- the passwords and takes back an attribute someone granted by hand.
--
-- That has to include the two that do not read as security attributes, because
-- they are the two that lock a role OUT rather than widen it: a CONNECTION
-- LIMIT of zero refuses every connection, and a VALID UNTIL in the past
-- refuses every password. Neither is touched by setting a password, so a file
-- that rotated credentials without restating them would report success over a
-- role that still cannot authenticate.
--
-- AN ATTRIBUTE IS NOT EVERYTHING A ROLE CARRIES, and the word is PostgreSQL's
-- rather than a loose one. A per-role configuration set by ALTER ROLE ... SET
-- lives in another catalogue, and a membership no statement below names is
-- left where it was; neither is restated, so a re-run is no answer to either.
--
-- ONE LOGIN ROLE PER CONTROL-PLANE PROCESS, and that is the point of the list
-- being this long. Every serving command under `src/roots/` asserts at start-up
-- that `current_user` is its own group role and refuses to serve otherwise, so
-- a shared credential would not merely widen a process's reach — it would stop
-- every process the credential does not belong to from starting at all. The two
-- administrative commands are outside that: `src/roots/migrate.ts` runs as the
-- owner and asserts nothing about the role it connected as, and
-- `src/roots/provisionProjectAccess.ts` states in its own header why it checks
-- a privilege instead.
--
-- A PROCESS WITH TWO POOLS STILL HAS ONE CREDENTIAL. The API opens a second
-- connection for the selector context — the proposal reviews it reads and the
-- approvals and rejections it records — and refuses to start unless it
-- becomes `chuggy_selector_review`, which is a group `chuggy_api` is not a
-- member of and is a real widening of `chuggy_api_login`. It is the widening
-- that process needs, and holding it through the group leaves what it reaches
-- editable in the migration rather than here. The connection string names the
-- group the same way the API's first one does.
--
-- chuggy_selector_control IS CREATED WITH NO LOGIN ROLE, DELIBERATELY. The
-- migration grants it the selector administration surface and no command under
-- `src/roots/` connects as it, so there is no process for a credential to
-- belong to; issuing one would put a live password behind a door nothing opens.
-- It is created here for the reason every group role is — so a membership grant
-- has a group, and so re-running this file is authoritative over its
-- attributes.
--
-- Usage:
--   CHUG_PG_OWNER_PASSWORD=... \
--   CHUG_PG_TICKET_SERVICE_PASSWORD=... \
--   CHUG_PG_API_PASSWORD=... \
--   CHUG_PG_SELECTOR_SERVICE_PASSWORD=... \
--   CHUG_PG_SCHEDULER_PASSWORD=... \
--   CHUG_PG_FINALIZER_PASSWORD=... \
--   CHUG_PG_WORKER_PLANE_PASSWORD=... \
--   CHUG_PG_CONFIGURATION_IMPORTER_PASSWORD=... \
--   psql -f deploy/rig/postgres/postgres-roles.sql

\set ON_ERROR_STOP on
\getenv owner_password CHUG_PG_OWNER_PASSWORD
\getenv ticket_service_password CHUG_PG_TICKET_SERVICE_PASSWORD
\getenv api_password CHUG_PG_API_PASSWORD
\getenv selector_service_password CHUG_PG_SELECTOR_SERVICE_PASSWORD
\getenv scheduler_password CHUG_PG_SCHEDULER_PASSWORD
\getenv finalizer_password CHUG_PG_FINALIZER_PASSWORD
\getenv worker_plane_password CHUG_PG_WORKER_PLANE_PASSWORD
\getenv configuration_importer_password CHUG_PG_CONFIGURATION_IMPORTER_PASSWORD
BEGIN;

-- The group roles the migration would otherwise be first to create. A DO block
-- would be the shorter conditional and psql does not interpolate a variable
-- inside one, so the whole file is \gexec rather than two idioms.
SELECT format('CREATE ROLE %I NOLOGIN', role_name)
  FROM unnest(ARRAY['chuggy_boundary_owner', 'chuggy_ticket_service', 'chuggy_api',
                    'chuggy_selector_service', 'chuggy_selector_control',
                    'chuggy_selector_review', 'chuggy_scheduler',
                    'chuggy_finalizer', 'chuggy_worker_plane',
                    'chuggy_configuration_importer']) AS role_name
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name)
\gexec

-- The identities that log in: one per service, plus the one that migrates.
SELECT format('CREATE ROLE %I LOGIN', role_name)
  FROM unnest(ARRAY['chuggy_owner', 'chuggy_ticket_service_login', 'chuggy_api_login',
                    'chuggy_selector_service_login', 'chuggy_scheduler_login',
                    'chuggy_finalizer_login', 'chuggy_worker_plane_login',
                    'chuggy_configuration_importer_login']) AS role_name
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name)
\gexec

-- A group role gets PASSWORD NULL here and a login role gets its password
-- below, which is the only attribute split between the two blocks.
ALTER ROLE chuggy_boundary_owner WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_ticket_service WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_api WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_selector_service WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_selector_control WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_selector_review WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_scheduler WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_finalizer WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_worker_plane WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_configuration_importer WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE chuggy_owner WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_ticket_service_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_api_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_selector_service_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_scheduler_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_finalizer_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_worker_plane_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_configuration_importer_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';

ALTER ROLE chuggy_owner PASSWORD :'owner_password';
ALTER ROLE chuggy_ticket_service_login PASSWORD :'ticket_service_password';
ALTER ROLE chuggy_api_login PASSWORD :'api_password';
ALTER ROLE chuggy_selector_service_login PASSWORD :'selector_service_password';
ALTER ROLE chuggy_scheduler_login PASSWORD :'scheduler_password';
ALTER ROLE chuggy_finalizer_login PASSWORD :'finalizer_password';
ALTER ROLE chuggy_worker_plane_login PASSWORD :'worker_plane_password';
ALTER ROLE chuggy_configuration_importer_login PASSWORD :'configuration_importer_password';

-- A service holds its capability through the group and never directly, so
-- widening one is an edit to the migration's grants and to nothing here.
GRANT chuggy_ticket_service TO chuggy_ticket_service_login;
GRANT chuggy_api TO chuggy_api_login;
GRANT chuggy_selector_service TO chuggy_selector_service_login;
GRANT chuggy_scheduler TO chuggy_scheduler_login;
GRANT chuggy_finalizer TO chuggy_finalizer_login;
GRANT chuggy_worker_plane TO chuggy_worker_plane_login;
GRANT chuggy_configuration_importer TO chuggy_configuration_importer_login;
GRANT chuggy_selector_review TO chuggy_api_login;
GRANT chuggy_boundary_owner, chuggy_ticket_service, chuggy_api, chuggy_selector_service,
      chuggy_selector_control, chuggy_selector_review, chuggy_scheduler,
      chuggy_finalizer, chuggy_worker_plane, chuggy_configuration_importer TO chuggy_owner;

-- CONNECT is granted to PUBLIC on a stock database and revoked on a hardened
-- one, so it is named rather than assumed. current_database() keeps the file
-- from carrying a database name it would then have to agree with.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name)
  FROM unnest(ARRAY['chuggy_owner', 'chuggy_ticket_service_login', 'chuggy_api_login',
                    'chuggy_selector_service_login', 'chuggy_scheduler_login',
                    'chuggy_finalizer_login', 'chuggy_worker_plane_login',
                    'chuggy_configuration_importer_login']) AS role_name
\gexec

GRANT USAGE, CREATE ON SCHEMA public TO chuggy_owner;
GRANT CREATE ON SCHEMA public TO chuggy_boundary_owner;
GRANT USAGE ON SCHEMA public TO chuggy_boundary_owner, chuggy_ticket_service, chuggy_api,
                                chuggy_selector_service, chuggy_selector_control,
                                chuggy_selector_review, chuggy_scheduler, chuggy_finalizer,
                                chuggy_worker_plane, chuggy_configuration_importer;

COMMIT;
