---
name: vteng-single-label-hosts
description: Public hostnames on vteng.io must be single-label; Cloudflare Universal SSL does not cover a second level
metadata: 
  node_type: memory
  type: project
  originSessionId: d5eeeeac-a07e-4a20-988c-b52567b06557
  modified: 2026-08-23T01:34:20.203Z
---

Every public hostname exposed from the gtr rig must be a **single label** under
`vteng.io` — `auth.vteng.io`, not `auth.chuggy.vteng.io`.

**Why:** the zone is on Cloudflare and TLS terminates at the edge with Universal
SSL, which covers the apex and **one** level of subdomain. A two-label host is
not covered and would need paid Advanced Certificate Manager (or Cloudflare for
SaaS). Verified 2026-08-22: `whoami.vteng.io` serves a Google Trust Services
cert whose only SAN is `whoami.vteng.io`, and the three hosts that existed then
— `whoami`, `grafana`, `sirdocalot` — were all single-label.

**How to apply:** when adding a host, pick a single label, add it to
`chuggy.tunnel.hostnames` in `hosts/gtr/default.nix` of the chuggy-fabric repo,
create the Cloudflare CNAME to `<tunnel-id>.cfargotunnel.com`, and add a Traefik
Ingress carrying that Host. All three steps are needed; the tunnel's catch-all
is `http_status:404`, so a missing hostname entry looks like a broken app.
Related: [[chuggy-rig]].
