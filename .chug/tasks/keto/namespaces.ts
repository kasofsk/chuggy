/**
 * The relation model `check-keto.sh` drives its own server with.
 *
 * IT IS A COPY OF WHAT THE FABRIC DEPLOYS, and nothing compares the two. A
 * gate proving the adapter against a model the installation does not run would
 * report a green verdict about a question the deployment answers differently,
 * so the deployed model changing without this file changing is the failure to
 * watch for; `src/adapters/keto/projectAccess.ts` readiness is what catches it
 * at a pod's door rather than here.
 *
 * IT IS NOT TYPESCRIPT THIS TREE COMPILES. `@ory/keto-namespace-types` is the
 * server's own package and is not a dependency here, so the file lives under
 * `.chug/`, which the compiler, the linter and the formatter all ignore.
 */

import { Namespace, Context } from "@ory/keto-namespace-types";

class User implements Namespace {}

class Tenant implements Namespace {
  related: {
    admins: User[];
    members: User[];
    hosted_execution: User[];
  };
  permits = {
    administer: (ctx: Context): boolean =>
      this.related.admins.includes(ctx.subject),
    invite: (ctx: Context): boolean => this.permits.administer(ctx),
    execute_hosted: (ctx: Context): boolean =>
      this.related.hosted_execution.includes(ctx.subject),
  };
}

class Project implements Namespace {
  related: {
    tenant: Tenant[];
    admins: User[];
    developers: User[];
    dispatchers: User[];
    agents: User[];
  };
  permits = {
    administer: (ctx: Context): boolean =>
      this.related.admins.includes(ctx.subject) ||
      this.related.tenant.traverse((t) => t.permits.administer(ctx)),
    develop: (ctx: Context): boolean =>
      this.related.developers.includes(ctx.subject) ||
      this.permits.administer(ctx),
    read: (ctx: Context): boolean =>
      this.permits.develop(ctx) || this.related.agents.includes(ctx.subject),
    propose: (ctx: Context): boolean => this.permits.develop(ctx),
    dispatch: (ctx: Context): boolean =>
      this.related.dispatchers.includes(ctx.subject) ||
      this.permits.administer(ctx),
    execute: (ctx: Context): boolean => this.permits.develop(ctx),
    manage_selector: (ctx: Context): boolean => this.permits.administer(ctx),
  };
}
