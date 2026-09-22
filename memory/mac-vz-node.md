---
name: mac-vz-node
description: 89tracy@192.168.0.175 M1 mini being prepared as a macOS-vz-kubelet node for gtr (Flutter/iOS builds); state and blockers
metadata:
  type: project
---

`ssh 89tracy@192.168.0.175` — Mac mini M1, 16GB, passwordless sudo, FileVault off.
Prepared 2026-09-17 to join the gtr k3s ([[chuggy-rig]]) via agoda-com/macOS-vz-kubelet @ b261641:
CLT 14.3, mise + go 1.26.4 in ~/.local/bin, signed binary `~/macos-vz/bin/MacOSVK`,
`kubelet.env` (node `macmini-m1`), `run-kubelet.sh`, unloaded LaunchDaemon plist
`com.vteng.macos-vz-kubelet.plist`; certs expected in `~/macos-vz/pki/` (none minted yet).
pmset sleep 0, autorestart 1. API server 192.168.0.114:6443 reachable.

**Host upgraded 2026-09-17 to macOS 26.7 (25G229)** via startosinstall (Geoff chose 26 over 27:
27 was days old and postdates the kubelet/vz; guest can be at most host version, 26 covers Xcode 26).
CLT 26.6 (SDK 26.5); kubelet rebuilt with -a and re-signed, no vz APIs disabled. Installer app
still in /Applications (~17GB, deletable). No console login after reboot (root LaunchDaemon doesn't need one).
**Joined gtr 2026-09-18 as node `macmini-m1`** (Ready, taint virtual-kubelet.io/provider=macos-vz:NoSchedule):
- Keys generated on the Mac; certs via CSR API (`macmini-m1-client`, signer kube-apiserver-client-kubelet;
  `macmini-m1-serving`, signer kubelet-serving, SAN 192.168.0.175), 365d, expire 2027-09-18 — renew before.
  APISERVER_CERT/KEY env = the kubelet's SERVING cert; the node identity is in pki/kubeconfig.
  APISERVER_CA_CERT_LOCATION = k3s client-ca (verifies the apiserver's calls in). VKUBELET_POD_IP=192.168.0.175
  is required (apiserver prefers InternalIP). Mac IP is Wi-Fi DHCP — wants a reservation.
- TRAP: NodeRestriction forbids the node setting `kubernetes.io/role`; VK only creates the Node when absent,
  so the Node object was pre-created by admin with VK's labels + os/arch + taint. Re-create it the same way.
- TRAP: k3s egress-selector `agent` mode can't reach a non-k3s kubelet (502 "failed to find Session");
  fabric PR #255 (merged 5e7561d, host generation 205, 2026-09-18) adds chuggy.k3s.egressSelectorMode, gtr = disabled.
- Secrets/configmaps list-watch forbidden errors in the kubelet log are noise (only the pod informer gates).
- Runs as LaunchDaemon /Library/LaunchDaemons/com.vteng.macos-vz-kubelet.plist (root, HOME=/var/root — it
  fails "$HOME is not defined" without it); log ~/macos-vz/log/kubelet.log. VM ssh key pki/vm_ssh_key(.pub),
  VZ_SSH_USER=admin — the guest image must carry that user + pubkey.
- Undo: `launchctl bootout system/com.vteng.macos-vz-kubelet`, rm the plist; `kubectl delete node macmini-m1`
  and `delete csr macmini-m1-client macmini-m1-serving`. The client cert can't be revoked (no CRL) — delete
  pki/client.key on the Mac.
- **TRAP (security): never pass `--authentication-token-webhook`** to MacOSVK @ b261641. It relaxes TLS to
  RequestClientCert, and main.go's option order (withWebhookAuth before configureRoutes, which replaces
  cfg.Handler) discards the auth wrapper: anonymous gets 200 on /pods and exec. Seen 2026-09-18 ~00:19–00:35,
  LAN only, no pods on the node. Without the flag: TLS requires a k3s client-CA cert, anonymous refused, but no
  authz (any client-CA cert = full access). Prometheus can't scrape it (bearer only) — by design, host metrics
  come from node_exporter instead.
- node_exporter 1.12.1 darwin-arm64 at /usr/local/bin, LaunchDaemon io.prometheus.node_exporter as nobody on
  :9100 (stderr /var/log/node_exporter.log must be nobody-owned or launchd exits 78). Fabric PR #256 wires it
  into job node-exporter (Grafana "Node Exporter / MacOS") and drops type=virtual-kubelet from the kubelet job.
- NoSchedule taint STAYS (Geoff agreed 2026-09-18 after asking to drop it): chuggy/ory/traefik/ksm/session pods carry no
  os selector and the scheduler would favour the empty Mac.
- VM image registry (fabric PR #257, host gen 206, 2026-09-18): ns chuggy-vm-registry, NodePort
  http://192.168.0.114:30500, 300Gi at /var/lib/chuggy/vm-registry, unauthenticated, NetworkPolicy admits only
  192.168.0.175 (externalTrafficPolicy Local); the workstation is refused. Separate from chuggy-registry on
  purpose (release images must not be LAN-writable). The Mac cannot reach ClusterIPs even with a 10.43/16 route.
Next: a 26.x guest image with Xcode 26 + Flutter + sshd via oras-macos-vz, pushed to 192.168.0.114:30500.
Max 2 VMs per host; 16GB realistically fits one Xcode VM.
