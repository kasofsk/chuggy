import type { ServiceRuntime, ServiceHealth } from "./serviceRuntime.ts";

/** Independent pacing loops share startup, health and bounded shutdown. */
export function runtimePair(
  left: ServiceRuntime,
  right: ServiceRuntime,
): ServiceRuntime {
  const members = [left, right] as const;
  const health = (): ServiceHealth => {
    const states = members.map((member) => member.health());
    const failure = states.find((state) => !state.live)?.failure;
    return {
      live: states.every((state) => state.live),
      ready: states.every((state) => state.ready),
      ...(failure === undefined ? {} : { failure }),
    };
  };
  const stop: ServiceRuntime["stop"] = async () => {
    const results = await Promise.all(members.map((member) => member.stop()));
    return {
      stopped: results.some((result) => result.stopped === "DrainExpired")
        ? "DrainExpired"
        : "Stopped",
    };
  };
  return {
    start: async () => {
      for (const member of members) {
        const started = await member.start();
        if (started.started !== "Started") {
          await stop();
          return started;
        }
      }
      return { started: "Started" };
    },
    health,
    stop,
    settled: async () => {
      await Promise.race(members.map((member) => member.settled()));
      return health();
    },
  };
}
