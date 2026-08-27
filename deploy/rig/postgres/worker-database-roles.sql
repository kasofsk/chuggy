-- The identity every worker of a site reaches PostgreSQL as, and the bound on
-- what an attempt can then do with it.
--
-- RUN AS A SUPERUSER, ON THE SERVER THE WORKERS USE. On this rig that is the
-- control plane's own server, and there is nothing to point elsewhere: a role
-- is cluster-wide, this file names no database and creates none, and the role
-- it makes owns nothing until an attempt asks it to.
--
-- WHAT SHARING ONE SERVER COSTS. Resources and availability: agent-authored
-- code runs against this server and may create databases on it, so an attempt
-- can spend disk and connection slots the durable authority also needs. This
-- file bounds neither, and on a rig this size neither is worth bounding.
--
-- WHAT IT MUST NOT COST, AND WHY IT DOES NOT. A read of the authority that
-- decides whether that code's work is accepted, or a way into one of the roles
-- that holds it. Neither is left to argument:
--
--   `postgres-roles.sql` takes CONNECT from PUBLIC on the chuggy database and
--   then gives it by name. Without that, PUBLIC's stock CONNECT admits every
--   role on the server, this one included, and a session that can read no
--   relation can still read the catalog — every table, column and function body
--   the deployment has.
--
--   This role is granted membership in nothing, and from PostgreSQL 16 a
--   CREATEROLE role administers only the roles it created: `GRANT chuggy_api TO
--   chuggy_worker` is refused for want of the ADMIN option. Before 16 a
--   CREATEROLE role could grant itself any non-superuser role, and this file
--   would be a way into the control plane rather than a role beside it.
--
-- WHY IT IS NOT IN `postgres-roles.sql`. Every login role that file creates is
-- granted CONNECT to the database it runs against, and this is the one login
-- that must not have it. Putting it there would make the file's own invariant
-- false, and this credential rotates on the workers' schedule besides.
--
-- WHAT AN ATTEMPT DOES WITH IT. `images/worker/postgres.mjs` uses this login
-- once, to make a role named for the attempt that owns one database. Ownership
-- is what separates one attempt from another: DROP DATABASE is the owner's, so
-- an attempt cannot take away a database another attempt made, and the
-- entrypoint revokes CONNECT from PUBLIC on its own so one cannot read
-- another's rows either.
--
-- WHY CREATEDB REACHES THE ATTEMPT TOO. `.chug/tasks/check-postgres.sh` clones
-- a database per worker from a template it prepares, so the attempt's own role
-- must be able to make databases beside the one it is given.
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
