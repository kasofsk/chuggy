---
name: auth-vision-interview-2026-09-10
description: "2026-09-10 interview with Geoff fixing the identity and access vision (tenants, roles, local workers, Keto/Oathkeeper, auth-as-a-feature) before the Keto/Oathkeeper decision document"
metadata: 
  node_type: memory
  type: project
  originSessionId: b35682d6-8a0f-4eda-a48f-cda44f6d8464
  modified: 2026-09-10T05:08:33.100Z
---

Decisions and intent from the 2026-09-10 interview on Keto and Oathkeeper:

- **Two horizons.** Long-term opportunity is an organisation running chuggy in its own infrastructure. The early step is **chuggy cloud**: a hosted, multi-tenant control plane (tickets, evidence, evaluation, finalization) with **users running local workers** for the agentic work on their own model keys. Cloud-hosted workers are unlikely soon (API cost). Chuggy will be open source.
- **Laser focus now:** local worker enrolment against chuggy cloud, and a first-class path to sign up, create a project, import or create a repo, and get to work. Keto/Oathkeeper are judged against those efforts, with the caveat of not entrenching authn/authz so later things get harder; Geoff is willing to adopt Keto early if the analysis says so.
- **Worker identity:** acting as the user's own credential is fine; enrolment by the user themselves via a simple script or app with an OAuth flow. Only give workers their own principal if there is a good reason to limit them.
- **Roles:** admins manage users and safety-critical settings (model choice, spend limits, selector and thread settings, finalization policies, adding users). Normal users are developers: employees, contractors, partners, friends. Filing briefs without hard dispatch is a plausible limit. Flexible; need not be right first time.
- **Scope:** membership per project is acceptable; tenant admins and project admins wanted; a person may belong to **several tenants** (Geoff expects to be added to many early). Signup creates whatever tenant/project is needed to start hacking.
- **Bounding:** a fresh signup must not be able to put work on the rig/hosted workers unless explicitly granted.
- **Agents:** audit trail must show an agent dispatched by a person; all workers have the same rights for now; approval flows (tickets by X need approval by Y) are future.
- **Git and finalization stay in chuggy infrastructure**, using the chuggy-portal / chuggy-worker GitHub Apps; only agentic work moves to local workers. Repo creation follows from the App installation. Chuggy-hosted git remains the eventual default.
- **Deployment adapters** per project: in-cluster (self-hosted), Cloudflare, localhost for trial users. Paved paths in the cluster (databases, endpoints, ingress) that agents are told about.
- **Auth as a feature:** chuggy's Ory stack should act as the auth layer for apps agents build and deploy, each project **optionally** getting its **own identity pool**. Geoff calls this a killer feature. Self-hosted orgs will bring their own SSO and likely skip Kratos, so the api must not assume Hydra is the issuer.
- A fully data-driven console (an embedded thread agent navigating the UI for the user) may precede the remote MCP surface.

**Why:** these are Geoff's calls, not derivable from the tree; the auth decision document is built on them.
**How to apply:** design against chuggy cloud plus local workers first; treat tenant as a relation not a token claim; keep one principal type; see [[multi-repo-project-requirements]] and [[chuggy-rig]].
