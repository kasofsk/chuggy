/**
 * The database one attempt gets on the server every worker of a site shares.
 *
 * WHY A SHARED SERVER AND NOT ONE PER IMAGE. A server inside the worker image
 * is a server per attempt: initialised on every start, sized by the pod's own
 * limits, and carried in every layer pulled to run work that never opens a
 * connection. What an attempt actually needs is a database nothing else is in,
 * and a database is cheap where a server is not.
 *
 * THE ATTEMPT GETS ITS OWN ROLE, NOT ONLY ITS OWN DATABASE. Agent-authored
 * code runs in this container and inherits this process's environment, so
 * whatever credential reaches the gates reaches the agent. A shared login
 * would therefore be a shared owner: every attempt on the server could read
 * and drop every other attempt's databases, which is the isolation the
 * per-attempt database was for. So the URL the site supplies is used once, to
 * make a role that owns one database and can make more beside it, and it is
 * removed from the environment before anything else runs. What the attempt's
 * role can still do is spend the server's disk, which is the deployment's to
 * bound.
 *
 * EVERY DATABASE THE ROLE OWNS IS DROPPED WITH IT. The gates make databases of
 * their own — `.chug/tasks/check-postgres.sh` clones one per worker — so
 * removing the one named here would leave the rest. Ownership is what the
 * server already tracks, so it is what the teardown asks by.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

/**
 * The alphabet a name this module creates is held to. Every identifier below
 * is written into SQL, and one that cannot be spelled without quoting is a
 * name this module refuses to have made rather than one it escapes.
 */
const unquotedName = /^[a-z][a-z0-9_]*$/u;

/** The password alphabet, chosen so a secret can never close the literal it sits in. */
function generatedSecret() {
  return randomBytes(24).toString("base64url");
}

/** A name the server chose rather than this module, so it is quoted rather than refused. */
function quotedName(value) {
  return `"${value.replace(/"/gu, '""')}"`;
}

/**
 * The connection as libpq's own variables, which is how the URL reaches psql:
 * a command line is readable by everything else in this container and a
 * child's environment is not, so the password travels there.
 */
function connectionEnvironment(url) {
  const at = new URL(url);
  const database = decodeURIComponent(at.pathname.replace(/^\//u, ""));
  const named = {
    PGHOST: decodeURIComponent(at.hostname),
    PGPORT: at.port === "" ? "5432" : at.port,
    PGUSER: decodeURIComponent(at.username),
    PGPASSWORD: decodeURIComponent(at.password),
    PGDATABASE: database === "" ? "postgres" : database,
  };
  for (const [parameter, value] of at.searchParams)
    named[`PG${parameter.toUpperCase()}`] = value;
  return named;
}

/** The same server as the attempt's own role, which is the URL the gates are given. */
function scopedUrl(url, name, password) {
  const at = new URL(url);
  at.username = name;
  at.password = password;
  at.pathname = `/${name}`;
  return at.toString();
}

export async function scopedDatabase(
  url,
  scope,
  services = {
    executeFile,
    environment: process.env,
    secret: generatedSecret,
  },
) {
  if (!unquotedName.test(scope))
    throw new Error(`worker database scope is not a plain name: ${scope}`);
  const connection = connectionEnvironment(url);
  const psql = async (...args) =>
    services.executeFile(
      "psql",
      ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", ...args],
      { env: { ...services.environment, ...connection } },
    );
  const statement = async (sql) => psql("--command", sql);

  const password = services.secret();
  await statement(
    `CREATE ROLE ${scope} LOGIN PASSWORD '${password}'` +
      " CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  );
  await statement(`CREATE DATABASE ${scope} OWNER ${scope}`);
  await statement(`REVOKE CONNECT ON DATABASE ${scope} FROM PUBLIC`);

  services.environment.CHUG_PG_URL = scopedUrl(url, scope, password);
  if (!services.environment.CHUG_PG_WORKERS)
    services.environment.CHUG_PG_WORKERS = "1";
  delete services.environment.CHUG_WORKER_DATABASE_URL;

  let dropped = false;
  return async () => {
    if (dropped) return;
    dropped = true;
    const { stdout } = await psql(
      "--tuples-only",
      "--no-align",
      "--command",
      `SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = '${scope}'`,
    );
    for (const database of stdout.split("\n").filter((line) => line !== ""))
      await statement(
        `DROP DATABASE IF EXISTS ${quotedName(database)} WITH (FORCE)`,
      );
    await statement(`DROP ROLE IF EXISTS ${scope}`);
  };
}
