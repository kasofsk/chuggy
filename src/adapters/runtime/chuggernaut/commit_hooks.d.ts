type Workload = Readonly<Record<string, unknown>>;
export declare function prepare_commit(
  workspace: string,
  base: string,
  workload: Workload,
  report: (text: string) => void,
  environment: NodeJS.ProcessEnv,
  message: string,
): Promise<string>;
export declare function run_pre_commit_hooks(
  workspace: string,
  base: string,
  workload: Workload,
  report: (text: string) => void,
  environment: NodeJS.ProcessEnv,
): Promise<void>;
export {};
