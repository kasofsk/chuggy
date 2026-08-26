import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const port = 55432;

export async function startLocalPostgres(
  workspace,
  services = { executeFile, mkdir, environment: process.env },
) {
  const root = join(workspace, ".chuggy", "postgres");
  const data = join(root, "data");
  const socket = join(root, "socket");
  const log = join(root, "postgres.log");
  await services.mkdir(data, { recursive: true });
  await services.mkdir(socket, { recursive: true });
  const { stdout } = await services.executeFile("pg_config", ["--bindir"]);
  const binaries = stdout.trim();
  await services.executeFile(join(binaries, "initdb"), [
    "--auth=trust",
    "--encoding=UTF8",
    "--no-locale",
    `--pgdata=${data}`,
    "--username=postgres",
  ]);
  await services.executeFile(join(binaries, "pg_ctl"), [
    "start",
    "--wait",
    `--pgdata=${data}`,
    `--log=${log}`,
    "--options",
    `-h 127.0.0.1 -p ${port} -k ${socket}`,
  ]);
  services.environment.CHUG_PG_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  services.environment.CHUG_PG_WORKERS = "1";
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await services.executeFile(join(binaries, "pg_ctl"), [
      "stop",
      "--wait",
      `--pgdata=${data}`,
      "--mode=fast",
    ]);
  };
}
