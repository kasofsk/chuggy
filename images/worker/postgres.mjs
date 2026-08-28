/**
 * The database one attempt gets on the server every worker of a site shares.
 *
 * WHY A SHARED SERVER AND NOT ONE PER IMAGE. A server inside the worker image
 * is a server per attempt: initialised on every start, sized by the pod's own
 * limits, and carried in every layer pulled to run work that never opens a
 * connection. What an attempt actually needs is a database nothing else is in,
 * and a database is cheap where a server is not.
 *
 * THE ATTEMPT GETS ITS OWN ROLE, NOT ONLY ITS OWN DATABASE. Agent-authored code
 * runs in this container and inherits this process's environment, so whatever
 * credential reaches the gates reaches the agent. A shared login would
 * therefore be a shared owner: every attempt could read and drop every other
 * attempt's databases, which is what the per-attempt database was for. So the
 * URL the site supplies is used once, to make a role that owns one database and
 * can make more beside it.
 *
 * DROPPING IT FROM THE ENVIRONMENT IS NOT HIDING IT. Nothing here puts that URL
 * out of reach of a process running as this one's user, whose /proc still holds
 * the environment this process was executed with; what the delete below stops
 * is a credential nobody asked for arriving in every child. What bounds the
 * credential itself is the server, and `deploy/rig/postgres/worker-database-roles.sql`
 * is where that bound is stated and argued.
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

/**
 * A name the server chose rather than this module, so it is quoted rather than
 * refused.
 * @param {string} value
 */
function quotedName(value) {
  return `"${value.replace(/"/gu, '""')}"`;
}

/**
 * The connection as libpq's own variables, which is how the URL reaches psql:
 * a command line is readable by everything else in this container and a
 * child's environment is not, so the password travels there.
 * @param {string} url
 * @returns {Record<string, string>}
 */
function connectionEnvironment(url) {
  const at = new URL(url);
  const database = decodeURIComponent(at.pathname.replace(/^\//u, ""));
  /** @type {Record<string, string>} */
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

/**
 * The same server as the attempt's own role, which is the URL the gates are
 * given.
 * @param {string} url
 * @param {string} name
 * @param {string} password
 */
function scopedUrl(url, name, password) {
  const at = new URL(url);
  at.username = name;
  at.password = password;
  at.pathname = `/${name}`;
  return at.toString();
}

/**
 * What one attempt's role and database are made by, in order, so a suite can
 * run the statements this ships rather than a copy of them.
 *
 * OWNING A DATABASE MEANS BEING ABLE TO BECOME ITS OWNER. The membership a
 * CREATEROLE role is given in a role it creates carries ADMIN and not SET:
 * enough to administer that role, not enough to create anything as it, and
 * `CREATE DATABASE ... OWNER` is refused for want of the second. The admin half
 * is what lets this grant the other one to itself.
 * @param {string} scope
 * @param {string} password
 * @returns {readonly string[]}
 */
export function scopedDatabaseStatements(scope, password) {
  return [
    `CREATE ROLE ${scope} LOGIN PASSWORD '${password}'` +
      " CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    `GRANT ${scope} TO CURRENT_USER WITH SET TRUE`,
    `CREATE DATABASE ${scope} OWNER ${scope}`,
    `REVOKE CONNECT ON DATABASE ${scope} FROM PUBLIC`,
  ];
}

/**
 * Every database one attempt's role owns, which is what its teardown drops.
 * @param {string} scope
 */
export function scopedDatabaseOwnedQuery(scope) {
  return `SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = '${scope}'`;
}

/**
 * @param {string} url
 * @param {string} scope
 * @param {{
 *   executeFile: (file: string, args: readonly string[], options?: object) => Promise<{ stdout: string }>,
 *   environment: Record<string, string | undefined>,
 *   secret: () => string,
 * }} [services]
 */
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
  /** @param {...string} args */
  const psql = async (...args) =>
    services.executeFile(
      "psql",
      ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", ...args],
      { env: { ...services.environment, ...connection } },
    );
  /** @param {string} sql */
  const statement = async (sql) => psql("--command", sql);

  const password = services.secret();
  for (const sql of scopedDatabaseStatements(scope, password))
    await statement(sql);

  services.environment["CHUG_PG_URL"] = scopedUrl(url, scope, password);
  if (!services.environment["CHUG_PG_WORKERS"])
    services.environment["CHUG_PG_WORKERS"] = "1";
  delete services.environment["CHUG_WORKER_DATABASE_URL"];

  let dropped = false;
  return async () => {
    if (dropped) return;
    dropped = true;
    const { stdout } = await psql(
      "--tuples-only",
      "--no-align",
      "--command",
      scopedDatabaseOwnedQuery(scope),
    );
    for (const database of stdout.split("\n").filter((line) => line !== ""))
      await statement(
        `DROP DATABASE IF EXISTS ${quotedName(database)} WITH (FORCE)`,
      );
    await statement(`DROP ROLE IF EXISTS ${scope}`);
  };
}
