/**
 * The relation model `check-keto.sh` drives its own server with.
 *
 * IT IS A COPY OF WHAT THE FABRIC DEPLOYS — the roles a person holds, and
 * beside them who may grant each role, who may make an account or a tenant and
 * who may change any of them — and nothing compares the two. A gate proving the adapter
 * against a model the installation does not run would report a green verdict
 * about a question the deployment answers differently, so the deployed model
 * changing without this file changing is the failure to watch for.
 * `src/adapters/keto/projectAccess.ts` readiness asks a deployment for every
 * namespace and for every permit the code names, so a model missing one or
 * having renamed one is caught at a pod's door rather than by the first member
 * it refuses. A permit still declared under a changed meaning — a
 * `develop` that no longer implies `read` — is caught by neither, and reading
 * this file against what the fabric applies is the only thing that finds it.
 *
 * A HOLDER IS A PERSON OR THE HOLDERS OF A ROLE, and never the holders of a
 * relation saying who may grant or manage, because Keto follows such a chain
 * and stops at its read depth with an ordinary denial.
 *
 * KETO ENFORCES NONE OF THE DECLARED TYPES. It stores any tuple and follows any
 * subject set, so what a holder may be is this tree's to refuse.
 *
 * A TENANT REACHES THE SITE BY ITS `site` TUPLE. One without it is not managed
 * from the site, with no error, though a holder written there as the site's
 * `admins` still holds.
 *
 * IT IS NOT TYPESCRIPT THIS TREE COMPILES. `@ory/keto-namespace-types` is the
 * server's own package and is not a dependency here, so the file lives under
 * `.chug/`, which the compiler, the linter and the formatter all ignore.
 */

import { Namespace, Context, SubjectSet } from "@ory/keto-namespace-types";

class User implements Namespace {}

class Site implements Namespace {
  related: {
    admins: User[];
    account_creators: (User | SubjectSet<Site, "admins"> | SubjectSet<Tenant, "admins">)[];
    tenant_creators: (User | SubjectSet<Site, "admins"> | SubjectSet<Tenant, "admins">)[];
    authority_managers: User[];
  };
  permits = {
    administer: (ctx: Context): boolean => this.related.admins.includes(ctx.subject),
    create_account: (ctx: Context): boolean => this.related.account_creators.includes(ctx.subject),
    create_tenant: (ctx: Context): boolean => this.related.tenant_creators.includes(ctx.subject),
    manage_authorities: (ctx: Context): boolean =>
      this.related.authority_managers.includes(ctx.subject) || this.permits.administer(ctx),
  };
}

class Tenant implements Namespace {
  related: {
    admins: User[];
    members: User[];
    hosted_execution: User[];
    site: Site[];
    admin_granters: (User | SubjectSet<Tenant, "admins"> | SubjectSet<Site, "admins">)[];
    member_granters: (User | SubjectSet<Tenant, "admins"> | SubjectSet<Tenant, "members"> | SubjectSet<Site, "admins">)[];
    hosted_execution_granters: (User | SubjectSet<Tenant, "admins"> | SubjectSet<Site, "admins">)[];
    authority_managers: (User | SubjectSet<Tenant, "admins">)[];
  };
  permits = {
    administer: (ctx: Context): boolean =>
      this.related.admins.includes(ctx.subject),
    invite: (ctx: Context): boolean => this.permits.administer(ctx),
    execute_hosted: (ctx: Context): boolean =>
      this.related.hosted_execution.includes(ctx.subject),
    grant_admin: (ctx: Context): boolean => this.related.admin_granters.includes(ctx.subject),
    grant_member: (ctx: Context): boolean => this.related.member_granters.includes(ctx.subject),
    grant_hosted_execution: (ctx: Context): boolean =>
      this.related.hosted_execution_granters.includes(ctx.subject),
    manage_site_held_authorities: (ctx: Context): boolean =>
      this.related.site.traverse((s) => s.permits.manage_authorities(ctx)),
    manage_authorities: (ctx: Context): boolean =>
      this.related.authority_managers.includes(ctx.subject) ||
      this.related.site.traverse((s) => s.permits.manage_authorities(ctx)),
  };
}

class Project implements Namespace {
  related: {
    tenant: Tenant[];
    admins: User[];
    developers: User[];
    dispatchers: User[];
    agents: User[];
    pools: User[];
    admin_granters: (User | SubjectSet<Project, "admins"> | SubjectSet<Tenant, "admins"> | SubjectSet<Site, "admins">)[];
    developer_granters: (User | SubjectSet<Project, "admins"> | SubjectSet<Project, "developers"> | SubjectSet<Tenant, "admins"> | SubjectSet<Site, "admins">)[];
    dispatcher_granters: (User | SubjectSet<Project, "admins"> | SubjectSet<Tenant, "admins"> | SubjectSet<Site, "admins">)[];
    authority_managers: (User | SubjectSet<Project, "admins"> | SubjectSet<Tenant, "admins">)[];
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
    execute: (ctx: Context): boolean =>
      this.related.pools.includes(ctx.subject) || this.permits.develop(ctx),
    manage_selector: (ctx: Context): boolean => this.permits.administer(ctx),
    grant_admin: (ctx: Context): boolean => this.related.admin_granters.includes(ctx.subject),
    grant_developer: (ctx: Context): boolean => this.related.developer_granters.includes(ctx.subject),
    grant_dispatcher: (ctx: Context): boolean => this.related.dispatcher_granters.includes(ctx.subject),
    manage_authorities: (ctx: Context): boolean =>
      this.related.authority_managers.includes(ctx.subject) ||
      this.related.tenant.traverse((t) => t.permits.manage_authorities(ctx)),
  };
}
