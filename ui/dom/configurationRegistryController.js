import {
  configurationRegistryInitial,
  configurationRegistryNext,
  configurationRegistryReceived,
  configurationRegistryRefresh,
} from "../app/configurationRegistry.js";
import {
  repositoryConfigurationImportAnswered,
  repositoryConfigurationImportEdited,
  repositoryConfigurationImportInitial,
  repositoryConfigurationImportSubmitted,
} from "../app/repositoryConfigurationImport.js";

/** @typedef {import("../app/configurationRegistry.js").ConfigurationRegistryRead} ConfigurationRegistryRead */
/** @typedef {import("../app/configurationRegistry.js").ConfigurationRegistryState} ConfigurationRegistryState */
/** @typedef {import("../app/protocol.js").Partition} Partition */

/** @param {Registry} registry @param {ConfigurationRegistryRead} read */
async function registryRead(registry, read) {
  registry.state.registry = read.state;
  registry.onChanged();
  const outcome = await registry.send(read.request);
  registry.state.registry = configurationRegistryReceived(read.state, outcome);
  registry.onChanged();
}

/**
 * @param {Registry} registry
 * @param {(token: string, partition: Partition) => ConfigurationRegistryRead | undefined} makeRead
 */
async function registryStart(registry, makeRead) {
  const token = await registry.session.accessToken();
  if (token === undefined || registry.state.partition === undefined) return;
  const read = makeRead(token, registry.state.partition);
  if (read !== undefined) await registryRead(registry, read);
}

/** @param {Registry} registry */
async function registryImport(registry) {
  const token = await registry.session.accessToken();
  if (token === undefined || registry.state.partition === undefined) return;
  const submission = repositoryConfigurationImportSubmitted(
    registry.state.import,
    token,
    registry.state.partition,
  );
  registry.state.import = submission.state;
  registry.onChanged();
  if (submission.request === undefined) return;
  const answered = repositoryConfigurationImportAnswered(
    submission.state,
    await registry.send(submission.request),
  );
  registry.state.import = answered.state;
  registry.onChanged();
  if (answered.event?.event === "ConfigurationsChanged")
    await registryStart(registry, (accessToken, partition) =>
      configurationRegistryRefresh(
        registry.state.registry,
        accessToken,
        partition,
      ),
    );
}

/**
 * @typedef {{ session: { accessToken: () => Promise<string | undefined> },
 *   send: (request: import("../app/protocol.js").ApiRequest) => Promise<import("../app/protocol.js").ApiOutcome>,
 *   onChanged: () => void,
 *   state: { partition: Partition | undefined,
 *     registry: ConfigurationRegistryState,
 *     import: import("../app/repositoryConfigurationImport.js").RepositoryConfigurationImportState } }} Registry
 */

/** @param {Pick<Registry, "session" | "send" | "onChanged">} parts */
export function createConfigurationRegistry(parts) {
  /** @type {Registry} */
  const registry = {
    session: parts.session,
    send: parts.send,
    onChanged: parts.onChanged,
    state: {
      partition: undefined,
      registry: {
        state: /** @type {const} */ ("Loading"),
        held: undefined,
        load: /** @type {const} */ ("Initial"),
      },
      import: repositoryConfigurationImportInitial(),
    },
  };
  return {
    state: registry.state,
    /** @param {Partition} partition */
    select: async (partition) => {
      registry.state.partition = partition;
      registry.state.import = repositoryConfigurationImportInitial();
      await registryStart(registry, (token, selected) =>
        configurationRegistryInitial(token, selected),
      );
    },
    refresh: () =>
      registryStart(registry, (token, partition) =>
        configurationRegistryRefresh(registry.state.registry, token, partition),
      ),
    next: () =>
      registryStart(registry, (token, partition) =>
        configurationRegistryNext(registry.state.registry, token, partition),
      ),
    /** @param {string} commit */
    editImport: (commit) => {
      registry.state.import = repositoryConfigurationImportEdited(commit);
    },
    import: () => registryImport(registry),
  };
}
