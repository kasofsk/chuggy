-- The identity every worker of a site reaches its shared PostgreSQL as, and
-- the bound on what an attempt can then do with it.
--
-- RUN AS A SUPERUSER, ON THE SERVER THE WORKERS SHARE, WHICH IS NOT THE ONE
-- THE CONTROL PLANE HOLDS ITS AUTHORITY IN. Agent-authored code runs against
-- this server and may create databases on it; the durable authority is what
-- decides whether that code's work is accepted at all. A server carrying both
-- would put the deciding rows within reach of what is being decided, and no
-- grant on this file's role would be evidence otherwise, because a role is
-- cluster-wide and a database is not a boundary against one that has CREATEDB.
-- This file names no database and belongs to no migration: the role it makes
-- owns nothing until an attempt asks it to.
--
-- WHAT AN ATTEMPT DOES WITH IT. `images/worker/postgres.mjs` uses this login
-- once, to make a role named for the attempt that owns one database, and then
-- drops that credential from the environment before agent-authored code runs.
-- So this password is the site's, held in the Secret the scheduler names, and
-- what the work reaches the server as is the attempt's own role.
--
-- WHY CREATEROLE, AND WHY IT IS NOT SUPERUSER-EQUIVALENT HERE. Making that
-- per-attempt role is the whole of what needs it, and from PostgreSQL 16 a
-- CREATEROLE role administers only the roles it created — before that it could
-- grant itself membership in any non-superuser role, `pg_execute_server_program`
-- among them, which is a shell as the server's own OS user. The version floor
-- is what makes the paragraph above true rather than merely hopeful, and it is
-- the same argument `postgres-roles.sql` makes for chuggy_owner.
--
-- WHY CREATEDB, AND WHAT IT DOES NOT REACH. An attempt's role is given CREATEDB
-- too, because `.chug/tasks/check-postgres.sh` clones a database per worker
-- from a template it prepares. Ownership is what separates one attempt from
-- another: DROP DATABASE is the owner's, so an attempt cannot take away a
-- database another attempt made, and the entrypoint revokes CONNECT from PUBLIC
-- on its own so one cannot read another's rows either. What is left shared is
-- the server's disk and its connection slots, which no grant bounds and a
-- deployment does.
--
-- RE-RUNNING IT ROTATES THE PASSWORD AND NOTHING ELSE. An empty one clears the
-- password rather than failing, which is the refusal `README.md` makes with
-- `:?` expansions before psql is reached.
--
-- Usage:
--   CHUG_PG_WORKER_PASSWORD=... \
--   psql -f deploy/rig/postgres/worker-database-roles.sql

\set ON_ERROR_STOP on
\getenv worker_password CHUG_PG_WORKER_PASSWORD
BEGIN;

SELECT format('CREATE ROLE %I LOGIN', 'chuggy_worker')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chuggy_worker')
\gexec

ALTER ROLE chuggy_worker WITH LOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE chuggy_worker PASSWORD :'worker_password';

COMMIT;
