# The rig's work isolation

A rehearsal of the work-isolation controls on the local k3s rig as it stands: a
work pool expressed as a node label and a `nodeSelector`, default-deny ingress
and egress on the namespace agent-authored work runs in, and the cloud metadata
endpoint refused by that policy rather than by the rig's not having one.

Each manifest argues itself in its own header. This is the procedure, and the
part of it that matters is not standing it up — it is the sequence that tells a
control working from a control that was never tested.

## Stand it up

```sh
kubectl apply -f deploy/rig/isolation/namespace.yaml \
              -f deploy/rig/isolation/work-denies-egress.yaml
```

The node's pool label is deliberately not in that command: the section below
applies the probe first, so that the label arriving is something to watch
rather than something to assume. It is a command rather than a manifest because
a node is not this tree's object to declare — k3s registers it, `--node-label`
in the server's arguments is where a permanent one belongs, and until the pool
split is real the label is one word about one machine.

## The placement half

`work-probe.yaml` carries `nodeSelector: chuggy.dev/pool: work` and nothing
else about where it runs. To see that the selector binds rather than decorates,
apply it before the node carries the label:

```
$ kubectl apply -f deploy/rig/isolation/work-probe.yaml
pod/work-probe created
$ kubectl -n chuggy-work describe pod work-probe | sed -n '/^Events:/,$p'
Events:
  Type     Reason            Age   From               Message
  ----     ------            ----  ----               -------
  Warning  FailedScheduling  4s    default-scheduler  0/1 nodes are available: 1 node(s) didn't match Pod's node affinity/selector. preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
$ kubectl label node gtr chuggy.dev/pool=work
node/gtr labeled
$ kubectl -n chuggy-work wait --for=condition=Ready pod/work-probe
pod/work-probe condition met
```

**There is deliberately no taint.** A work-pool `NoSchedule` taint on the only
node would force every system workload on it — Flux's controllers, the
PostgreSQL StatefulSet — to carry a toleration, which is the inverse of the
split production wants and a manifest the GCP apply would then have to undo.
The taint belongs to the pool split the apply builds.

**And there is no second pool.** One node cannot hold two values of one label
key, so the system half of the split is expressed by nothing here: system
workloads carry no selector and land on the same machine the work pods do. The
label and the selector say what the placement rule is. Only a second node makes
it a placement.

## The policy half

`work-denies-egress.yaml` selects every pod in the namespace and permits no
destination in either direction. The rig's NetworkPolicy controller is k3s's
embedded kube-router, which enforces ingress and egress alike. It programs one
chain per pod, and `iptables-save` shows the whole of it:

```
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "rule for stateful firewall for pod" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "rule to drop invalid state for pod" -m conntrack --ctstate INVALID -j DROP
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -d 10.42.1.59/32 -m comment --comment "rule to permit the traffic traffic to pods when source is the pod\'s local node" -m addrtype --src-type LOCAL -j ACCEPT
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "run through nw policy work-denies-egress" -j KUBE-NWPLCY-JX2HQOW4QTTIKQYI
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "rule to log dropped traffic POD name:work-probe namespace: chuggy-work" -m mark ! --mark 0x10000/0x10000 -m limit --limit 10/min --limit-burst 10 -j NFLOG --nflog-group 100
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "rule to REJECT traffic destined for POD name:work-probe namespace: chuggy-work" -m mark ! --mark 0x10000/0x10000 -j REJECT --reject-with icmp-port-unreachable
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -j MARK --set-xmark 0x0/0x10000
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -m comment --comment "set mark to ACCEPT traffic that comply to network policies" -j MARK --set-xmark 0x20000/0x20000
```

The first three rules are why the claim is about *new* connections and no more:
a packet on a `RELATED,ESTABLISHED` connection is ACCEPTed at rule 1, an
`INVALID` one dropped at rule 2, and anything the node itself sources toward the
pod ACCEPTed at rule 3 — none of those reach the policy jump. A packet on a new
connection does. The chain it jumps to (`KUBE-NWPLCY-...`) holds one logging
rule and nothing that marks a packet compliant, so it falls back out unmarked
and every packet on a new connection reaches the `REJECT`. Two things follow.
The policy jump names no destination and no source, so no address is treated
differently from any other. And the refusal is an **active ICMP
port-unreachable** rather than a silent drop — which is what lets the caller
tell it apart from a destination that simply is not there, and is the whole of
the rehearsal below.

## Proving it, on a pod that never moves

Toggle the policy around an already-running probe. A freshly created pod is the
tempting shape and the unreliable one: the controller learns a new pod's labels
on its own schedule, so a pod that connects the instant it starts can be
refused for reasons that have nothing to do with the policy. Holding the pod
still leaves the policy as the only thing that changed.

The verdict is `open` or `failed` from a TCP connect; the elapsed time and the
reason are what discriminate one failure from another, so a failed connect is
labelled `failed` and nothing more — the timing and the `wget` reason carry the
rest. The reason comes from an HTTP fetch at the same address, because that is
the caller that reports *why*. Timing is read from `/proc/uptime`, not
`date +%s`: a whole-second clock cannot tell a sub-second reject from a slow
one, and the difference between the two states is measured in fractions of a
second.

```sh
kubectl -n chuggy-work exec work-probe -- sh -c '
  el() { awk -v s="$1" -v e="$2" "BEGIN{printf \"%.2fs\", e-s}"; }
  for t in 169.254.169.254:80 10.43.0.1:443 10.43.0.10:53 1.1.1.1:443; do
    h="${t%%:*}"; p="${t##*:}"; s="$(cut -d" " -f1 /proc/uptime)"
    if nc -w 3 "$h" "$p" </dev/null >/dev/null 2>&1; then v=open; else v=failed; fi
    e="$(cut -d" " -f1 /proc/uptime)"
    printf "tcp  %-20s %-8s %-7s  %s\n" "$t" "$v" "$(el "$s" "$e")" \
      "$(wget -T 3 -q -O /dev/null "http://$t/" 2>&1)"
  done
  s="$(cut -d" " -f1 /proc/uptime)"
  d="$(nslookup -timeout=3 kubernetes.default.svc.cluster.local 2>&1 | tr "\n" " ")"
  e="$(cut -d" " -f1 /proc/uptime)"
  printf "dns  %-20s %-8s %-7s  %s\n" kubernetes.default - "$(el "$s" "$e")" "$d"'
```

Before the policy, with the pod running and the address unchanged:

```
tcp  169.254.169.254:80   failed   3.00s    wget: download timed out
tcp  10.43.0.1:443        open     0.00s    wget: server returned error: HTTP/1.0 400 Bad Request
tcp  10.43.0.10:53        open     0.00s    wget: download timed out
tcp  1.1.1.1:443          open     0.04s    wget: server returned error: HTTP/1.1 400 Bad Request
dns  kubernetes.default   -        0.00s    Server: 10.43.0.10 Address: 10.43.0.10:53   Name: kubernetes.default.svc.cluster.local Address: 10.43.0.1
```

With it applied:

```
tcp  169.254.169.254:80   failed   1.01s    wget: can't connect to remote host (169.254.169.254): Connection refused
tcp  10.43.0.1:443        failed   1.02s    wget: can't connect to remote host (10.43.0.1): Connection refused
tcp  10.43.0.10:53        failed   1.02s    wget: can't connect to remote host (10.43.0.10): Connection refused
tcp  1.1.1.1:443          failed   1.02s    wget: can't connect to remote host (1.1.1.1): Connection refused
dns  kubernetes.default   -        1.51s    nslookup: write to '10.43.0.10': Connection refused ;; connection timed out; no servers could be reached
```

Delete the policy and every line returns to the first table, on the same pod,
with no restart between them.

## The metadata endpoint, and why the obvious reading of it is worthless

**This rig has no cloud metadata service.** Nothing answers at 169.254.169.254
whether or not any policy exists, so a rehearsal that reached for the address,
watched it fail and reported the endpoint blocked would be reporting the
absence of a service as the presence of a control — believed once and never
checked again.

What separates the two here is the *character* of the refusal, and the tables
above are the whole argument. Before the policy the address answers nothing and
says nothing: the caller waits out its full timeout, the longest row in the
table. After it, the same caller at the same address is told **Connection
refused** — the ICMP port-unreachable the `REJECT` above emits — in the same
words and at the same speed as three addresses that were answering a moment
earlier and have now been refused by the same rule. That speed is not instant,
and the elapsed column says so: a genuinely local refusal, with nothing
listening, returns at once, while these land about a round-trip later, because
the kernel treats an ICMP port-unreachable arriving mid-handshake as a soft
error and surfaces it on the first SYN retransmit rather than aborting on the
spot. What carries the verdict is that the refused rows are uniform and
decisively quicker than the wait-out, with the reason string naming the cause —
not the round number in any single cell. The address did not change and nothing
began listening on it. The refusal is the policy's.

**Probe it with `ping` and you learn nothing**: ICMP echo to that address is
silent in both states, so the flip is invisible. That is the shape of the trap
in one command.

What this does **not** establish is that a metadata service, had one existed,
would have been unreachable. Establishing that needs the address to answer
first, and it cannot be made to on this rig: a pod bearing an address that is
not its own can receive traffic but its replies are dropped before they reach
another pod, and the alternative — a route on the node — is a change to the
node's networking that a rehearsal has no business making. So the claim rests
on the rule being destination-blind and on every destination that *could*
answer being refused, not on an observation of that endpoint serving.

## What the policy does not constrain, and what does

A pod with `hostNetwork: true` has no address of its own — its traffic carries
the node's — and kube-router keys everything it programs on pod addresses. On
the way out there is simply no chain for such a source, so no egress rule can
select it. On the way in it is exempted by name, in a rule that sits above the
policy jump in every pod's chain:

```
-A KUBE-POD-FW-QFZZRIISKDZ26IQ5 -d 10.42.1.59/32 -m comment --comment "rule to permit the traffic traffic to pods when source is the pod\'s local node" -m addrtype --src-type LOCAL -j ACCEPT
```

So no NetworkPolicy in this cluster constrains a host-network workload in
either direction. Same namespace, same policy, the same two addresses:

```
=== work-probe (pod network) ===
tcp  10.43.0.1:443        failed   1.02s    wget: can't connect to remote host (10.43.0.1): Connection refused
tcp  1.1.1.1:443          failed   1.02s    wget: can't connect to remote host (1.1.1.1): Connection refused
=== host-network-probe (host network) ===
tcp  10.43.0.1:443        open     0.00s    wget: server returned error: HTTP/1.0 400 Bad Request
tcp  1.1.1.1:443          open     0.04s    wget: server returned error: HTTP/1.1 400 Bad Request
```

**The boundary this row draws is against pod-network traffic only.** What keeps
that from being one field away from irrelevant is the namespace's Pod Security
labels, which refuse the field at admission:

```
$ kubectl apply -f deploy/rig/isolation/host-network-probe.yaml
Error from server (Forbidden): error when creating "deploy/rig/isolation/host-network-probe.yaml": pods "host-network-probe" is forbidden: violates PodSecurity "baseline:latest": host namespaces (hostNetwork=true)
```

To see the hole itself rather than its lid, drop the enforcement, reapply the
probe, and put it back:

```sh
kubectl label --overwrite ns chuggy-work pod-security.kubernetes.io/enforce-
kubectl apply -f deploy/rig/isolation/host-network-probe.yaml
# ... measure, then:
kubectl -n chuggy-work delete pod host-network-probe
kubectl apply -f deploy/rig/isolation/namespace.yaml
```

The node itself is not constrained either, and neither is any host-network pod
elsewhere on it. Nothing here changes that; admission is what keeps such a pod
out of *this* namespace.

## What else is refused

The namespace's `default` ServiceAccount carries
`automountServiceAccountToken: false` (set in `namespace.yaml`), so a pod that
names no ServiceAccount — as a work pod does not — holds no API credential. That
control is namespace-wide like the egress policy and the Pod Security labels: it
holds for anything scheduled into `chuggy-work`, not only for a pod that thought
to set the field on itself.

```
$ kubectl -n chuggy-work exec work-probe -- ls /var/run/secrets
ls: /var/run/secrets: No such file or directory
```

Egress denial already refuses the API server's address, and this refuses the
credential as well, so neither control is the only one standing.

## What this does not prove

Said plainly, so nobody trusts it further than it goes.

- **That work and system are different machines.** One node makes them the
  same. The label and the selector express the split; only a second node would
  prove it.
- **That the metadata endpoint would be refused if it existed.** See above.
- **That the method carries to another CNI.** The whole discrimination above —
  an active reject read apart from a silent timeout — is kube-router's
  behaviour. Under Calico, Cilium or GKE Dataplane V2 a denied connection is a
  silent timeout in *both* states, indistinguishable from a destination that is
  simply absent, and this rehearsal's evidence collapses into the worthless
  reading it warns against. Not just the conclusion but the method is the rig's;
  the GCP apply must re-establish both.
- **Anything over IPv6.** kube-router programs the policy in `iptables` only; a
  parallel `ip6tables-save` on the node holds no `KUBE-POD-FW` chain at all,
  while `cni0` and every pod veth carry an `fe80::/64` link-local on one shared
  bridge. A work pod under the policy keeps its own link-local and reaches the
  node bridge over it — `ping6 ff02::1%eth0` draws a reply from `cni0` while
  every IPv4 destination is refused. The boundary this row draws is IPv4-only;
  nothing here bounds IPv6, and the GCP apply either policies it or disables it
  for the pod netns.
- **That a raw socket cannot forge its way out.** Baseline PSA leaves
  `CAP_NET_RAW`, and kube-router keys every jump on the source IP with no
  catch-all. A work pod can open a raw socket, forge the source of a pod whose
  namespace has no egress policy, and the packet lands in *that* pod's
  default-allow chain and is masqueraded off the node — while every destination
  it sends from its own address is refused. Egress denial here binds a pod's own
  source, not a forged one.
- **Anything about a host-network source, the node, or another namespace.**
- **Anything about egress from the cluster's own infrastructure.** Flux, the
  PostgreSQL StatefulSet and the ingress are untouched by this row.

## Undoing it

```sh
kubectl delete namespace chuggy-work
kubectl label node gtr chuggy.dev/pool-
```

Nothing outside that namespace and that one node label was created or altered —
not the Flux controllers, not `flux-system`, not `chuggy`, not `chuggy-git`,
and nothing on the host.
