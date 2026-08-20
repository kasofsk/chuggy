-- The identities a chuggy deployment owns, and the privileges no migration can
-- grant itself.
--
-- RUN AS A SUPERUSER, AGAINST THE TARGET DATABASE, BEFORE ANYTHING MIGRATES. A
-- role is cluster-wide and a schema grant is not, so both halves below land
-- only when the connection is to the database the relations will live in.
--
-- WHY THE MIGRATING IDENTITY IS NOT THE SUPERUSER. Cancellation is a
-- SECURITY DEFINER function and executes with the privileges of whoever created
-- it, so a superuser migration hands every caller that may execute it a
-- superuser's reach. chuggy_owner migrates instead: it owns the relations and
-- the function, and holds one attribute beyond ownership.
--
-- WHY THAT ATTRIBUTE IS CREATEROLE. The migration creates its group roles
-- itself, and creating a role is not something owning an object confers. It is
-- kept even though this file leaves nothing for those statements to do: a
-- migration that adds a group role would otherwise fail at start-up on every
-- cluster where this file was not re-run first, which is a coupling between a
-- future migration and a deployment step that nothing checks. CREATEROLE is not
-- superuser, which is the property the SECURITY DEFINER function turns on.
--
-- WHY THE GROUP ROLES ARE CREATED HERE AS WELL. A membership grant needs the
-- group to exist, and a deployment issues credentials before the process that
-- migrates has ever started. Creation is check-then-act against pg_roles, the
-- same shape the migration uses and for the reason it states: a role is
-- cluster-wide, so a sibling database may have made it first.
--
-- WHY chuggy_owner IS A MEMBER OF BOTH GROUPS. It owns the relations, so
-- membership confers no privilege it did not already hold. What it buys is
-- SET ROLE, which is how the privilege suite asks the server what each group
-- role is refused.
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
-- ALTER statements restate every attribute rather than the ones being changed,
-- and a repeated grant is a no-op. Re-running it rotates the passwords and
-- takes back an attribute someone granted by hand.
--
-- Usage:
--   CHUG_PG_OWNER_PASSWORD=... \
--   CHUG_PG_DISPATCHER_PASSWORD=... \
--   CHUG_PG_API_PASSWORD=... \
--   psql -f deploy/rig/postgres-roles.sql

\set ON_ERROR_STOP on
\getenv owner_password CHUG_PG_OWNER_PASSWORD
\getenv dispatcher_password CHUG_PG_DISPATCHER_PASSWORD
\getenv api_password CHUG_PG_API_PASSWORD
BEGIN;

-- The group roles the migration would otherwise be first to create. A DO block
-- would be the shorter conditional and psql does not interpolate a variable
-- inside one, so the whole file is \gexec rather than two idioms.
SELECT format('CREATE ROLE %I NOLOGIN', role_name)
  FROM unnest(ARRAY['chuggy_dispatcher', 'chuggy_api']) AS role_name
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name)
\gexec

-- The identities that log in: one per service, plus the one that migrates.
SELECT format('CREATE ROLE %I LOGIN', role_name)
  FROM unnest(ARRAY['chuggy_owner', 'chuggy_dispatcher_login', 'chuggy_api_login']) AS role_name
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name)
\gexec

ALTER ROLE chuggy_dispatcher WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE chuggy_api WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE chuggy_owner WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE chuggy_dispatcher_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE chuggy_api_login WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE chuggy_owner PASSWORD :'owner_password';
ALTER ROLE chuggy_dispatcher_login PASSWORD :'dispatcher_password';
ALTER ROLE chuggy_api_login PASSWORD :'api_password';

-- A service holds its capability through the group and never directly, so
-- widening one is an edit to the migration's grants and to nothing here.
GRANT chuggy_dispatcher TO chuggy_dispatcher_login;
GRANT chuggy_api TO chuggy_api_login;
GRANT chuggy_dispatcher, chuggy_api TO chuggy_owner;

-- CONNECT is granted to PUBLIC on a stock database and revoked on a hardened
-- one, so it is named rather than assumed. current_database() keeps the file
-- from carrying a database name it would then have to agree with.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name)
  FROM unnest(ARRAY['chuggy_owner', 'chuggy_dispatcher_login', 'chuggy_api_login']) AS role_name
\gexec

GRANT USAGE, CREATE ON SCHEMA public TO chuggy_owner;
GRANT USAGE ON SCHEMA public TO chuggy_dispatcher, chuggy_api;

COMMIT;
