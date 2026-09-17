import * as task from "../../domain/chuggernaut/task.js";
import * as evaluation from "../../domain/chuggernaut/evaluation.js";
import * as ticket from "../../domain/chuggernaut/ticket.js";
import {
  canonical_json,
  copy_json_metadata,
  parse_json,
} from "../../interpreter/chuggernaut/json.js";
import type {
  TicketCatalog,
  TicketCatalogSource,
  TicketContentStore,
  TicketCatalogRelease,
} from "../../interpreter/ticketCatalog.ts";
import type { TicketPullRequestConfiguration } from "../../interpreter/ticketPullRequest.ts";
import { schema_validator } from "./chuggernaut/json_schema.js";
import {
  catalogCheck,
  catalogDocument,
  catalogDocumentBytesMax,
  catalogReference,
  documentMapping,
  type CatalogDocument,
} from "./document.ts";

type Fragment = string | CatalogDocument;
interface TicketDocument {
  readonly title?: string;
  readonly instructions?: string;
  readonly dependencies?: readonly number[];
  readonly inputs?: CatalogDocument;
  readonly rework_limit?: number;
  readonly work: Fragment;
  readonly evaluation: Fragment;
  readonly finalization: Fragment;
}
interface WorkloadDocument extends CatalogDocument {
  readonly result_contract: Fragment;
  readonly execution_profile?: string;
  readonly publishes_repository_result?: boolean;
  readonly prompt?: string;
  readonly cloud_identity?: {
    readonly workload: string;
    readonly identity: string;
  };
}
interface EvaluatorDocument {
  readonly name: string;
  readonly workload: Fragment;
}
interface PlanDocument {
  readonly stages: readonly {
    readonly name: string;
    readonly evaluators: readonly Fragment[];
  }[];
}
interface CatalogContext {
  readonly source: TicketCatalogSource;
  readonly content: TicketContentStore;
  readonly files: Map<string, string>;
}

async function catalogRead(
  context: CatalogContext,
  path: string,
): Promise<string> {
  const cached = context.files.get(path);
  if (cached !== undefined) return cached;
  if (context.files.size >= 1000)
    throw new RangeError("catalog reference limit exceeded");
  const content = await context.source.read(path);
  if (Buffer.byteLength(content) > catalogDocumentBytesMax)
    throw new RangeError("catalog file exceeds size limit");
  context.files.set(path, content);
  return content;
}

async function catalogFragment<T extends object>(
  context: CatalogContext,
  authored: Fragment,
  directory: string,
  kind: string,
): Promise<T> {
  const document =
    typeof authored === "string"
      ? catalogDocument(
          await catalogRead(
            context,
            catalogReference(authored, directory, ".yaml"),
          ),
        )
      : authored;
  return catalogCheck<T>(kind, document);
}

async function catalogResultContract(
  context: CatalogContext,
  authored: Fragment,
): Promise<task.ContentRef> {
  const schema: unknown =
    typeof authored === "string"
      ? parse_json(
          await catalogRead(
            context,
            catalogReference(authored, "result-contracts", ".schema.json"),
          ),
        )
      : authored;
  if (!documentMapping(schema))
    throw new TypeError("result contract must be a JSON Schema object");
  const validator = schema_validator(schema);
  if (!validator.validateSchema(schema))
    throw new TypeError(
      `invalid result contract: ${JSON.stringify(validator.errors)}`,
    );
  return context.content.put("application/schema+json", canonical_json(schema));
}

function catalogCloudIdentity(
  context: CatalogContext,
  workload: WorkloadDocument,
  resolved: CatalogDocument,
  container: string,
): void {
  if (workload.cloud_identity === undefined) return;
  const project = context.source.cloudProject;
  if (
    project === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}\/[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u.test(
      project,
    )
  )
    throw new TypeError("cloud_identity requires a valid cloud_project");
  if (
    Buffer.byteLength(
      `${project}:${workload.cloud_identity.workload}:${container}`,
    ) > 127
  )
    throw new TypeError("cloud identity composite exceeds size limit");
  resolved["cloud_identity"] = { ...workload.cloud_identity, project };
}

async function catalogTask(
  context: CatalogContext,
  authored: Fragment,
  repository: task.ContentRef,
  inputs: task.ContentRef,
  container: string,
): Promise<task.TaskDefinition> {
  const workload = await catalogFragment<WorkloadDocument>(
    context,
    authored,
    "workloads",
    "workload",
  );
  const contract = await catalogResultContract(
    context,
    workload.result_contract,
  );
  if (container !== "work" && "publishes_repository_result" in workload)
    throw new TypeError(
      "evaluator workloads must not declare publishes_repository_result",
    );
  const access =
    container !== "work" || workload.publishes_repository_result === false
      ? new task.ReadRepository()
      : new task.PublishRepositoryResult();
  const resolved = copy_json_metadata<CatalogDocument>(workload, {
    ...workload,
  });
  delete resolved["result_contract"];
  delete resolved["publishes_repository_result"];
  let capabilities: readonly string[] = [];
  if (workload.execution_profile !== undefined) {
    const profile = context.source.executionProfiles.get(
      workload.execution_profile,
    );
    if (profile === undefined)
      throw new TypeError(
        `unknown execution profile: ${workload.execution_profile}`,
      );
    resolved["execution_profile"] = {
      name: workload.execution_profile,
      ...profile,
    };
    capabilities = profile.required_capabilities;
  }
  if (workload.prompt?.startsWith("agents/"))
    resolved["prompt"] = await catalogRead(
      context,
      catalogReference(workload.prompt, "agents", ".md"),
    );
  catalogCloudIdentity(context, workload, resolved, container);
  return new task.TaskDefinition(
    await context.content.put("application/json", canonical_json(resolved)),
    inputs,
    new task.ExecutionRequirements(repository, access, capabilities),
    contract,
  );
}

interface CatalogPlan {
  readonly plan: evaluation.EvaluationPlan;
  readonly stageNames: ReadonlyMap<task.StageKey, string>;
  readonly evaluatorNames: ReadonlyMap<task.EvaluatorKey, string>;
}

async function catalogPlan(
  context: CatalogContext,
  authored: Fragment,
  repository: task.ContentRef,
  inputs: task.ContentRef,
): Promise<CatalogPlan> {
  const document = await catalogFragment<PlanDocument>(
    context,
    authored,
    "evaluation-plans",
    "evaluation-plan",
  );
  const stages: evaluation.StageDefinition[] = [];
  const stageNames = new Map<task.StageKey, string>();
  const evaluatorNames = new Map<task.EvaluatorKey, string>();
  const keys = new Map<string, task.EvaluatorKey>();
  const seen = new Set<string>();
  for (const [index, stage] of document.stages.entries()) {
    if (seen.has(stage.name))
      throw new TypeError(`duplicate stage name: ${stage.name}`);
    seen.add(stage.name);
    const key = task.StageKey(index + 1);
    stageNames.set(key, stage.name);
    const evaluators: evaluation.EvaluatorDefinition[] = [];
    const names = new Set<string>();
    for (const authoredEvaluator of stage.evaluators) {
      const evaluator = await catalogFragment<EvaluatorDocument>(
        context,
        authoredEvaluator,
        "evaluators",
        "evaluator",
      );
      if (names.has(evaluator.name))
        throw new TypeError(`duplicate evaluator in stage: ${evaluator.name}`);
      names.add(evaluator.name);
      const evaluatorKey =
        keys.get(evaluator.name) ?? task.EvaluatorKey(keys.size + 1);
      keys.set(evaluator.name, evaluatorKey);
      evaluatorNames.set(evaluatorKey, evaluator.name);
      evaluators.push(
        new evaluation.EvaluatorDefinition(
          evaluatorKey,
          await catalogTask(
            context,
            evaluator.workload,
            repository,
            inputs,
            `eval:${String(key)}:${String(evaluatorKey)}`,
          ),
        ),
      );
    }
    stages.push(new evaluation.StageDefinition(key, evaluators));
  }
  return {
    plan: new evaluation.EvaluationPlan(stages),
    stageNames,
    evaluatorNames,
  };
}

async function catalogRelease(
  context: CatalogContext,
  identity: task.TicketId,
  source: string,
): Promise<TicketCatalogRelease> {
  const document = catalogCheck<TicketDocument>(
    "ticket",
    catalogDocument(source),
  );
  const repository = await context.content.put(
    "text/plain",
    context.source.repository,
  );
  const inputs = await context.content.put(
    "application/json",
    canonical_json(document.inputs ?? {}),
  );
  const work = await catalogTask(
    context,
    document.work,
    repository,
    inputs,
    "work",
  );
  const plan = await catalogPlan(
    context,
    document.evaluation,
    repository,
    inputs,
  );
  const finalizer = await catalogFragment<TicketPullRequestConfiguration>(
    context,
    document.finalization,
    "finalizers",
    "finalizer",
  );
  if (work.execution_requirements.access.kind !== "PublishRepositoryResult")
    throw new TypeError(
      "pull-request finalization requires work that publishes a repository result",
    );
  const configuration = { ...finalizer, merge: finalizer.merge ?? false };
  const definition = new ticket.ReleasedTicket(
    identity,
    new ticket.AuthoredContent(
      await context.content.put("text/plain", document.title ?? ""),
      await context.content.put("text/markdown", document.instructions ?? ""),
    ),
    inputs,
    new Set((document.dependencies ?? []).map(task.TicketId)),
    work,
    plan.plan,
    await context.content.put(
      "application/json",
      canonical_json(configuration),
    ),
  );
  ticket.validate_release(definition);
  return {
    definition,
    stageNames: plan.stageNames,
    evaluatorNames: plan.evaluatorNames,
    reworkLimit: document.rework_limit ?? context.source.reworkLimit,
    reworkLimitDeclared: document.rework_limit !== undefined,
  };
}

export function ticketCatalog(
  source: TicketCatalogSource,
  content: TicketContentStore,
): TicketCatalog {
  return {
    release: (identity, document) =>
      catalogRelease({ source, content, files: new Map() }, identity, document),
  };
}
