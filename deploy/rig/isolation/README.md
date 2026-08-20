# The rig's work isolation

Row D3 of the deployment rehearsal, on the local k3s rig as it stands: a work
pool expressed as a node label and a `nodeSelector`, default-deny egress on the
namespace agent-authored work runs in, and the cloud metadata endpoint refused
by that policy rather than by the rig's not having one.

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

## The egress half

`work-denies-egress.yaml` selects every pod in the namespace and permits no
destination. The rig's NetworkPolicy controller is k3s's embedded kube-router,
which enforces egress as well as ingress, and the rule it programs for a
selected pod is keyed on the pod's own address with no destination match at
all:

```
-A KUBE-POD-FW-GVN5Y6G7G75YPZCR -s 10.42.1.39/32 -m comment --comment "run through nw policy work-denies-egress" -j KUBE-NWPLCY-XOZIN6YKD2YNS7MO
-A KUBE-POD-FW-GVN5Y6G7G75YPZCR -m comment --comment "rule to REJECT traffic destined for POD name:work-probe namespace: chuggy-work" -m mark ! --mark 0x10000/0x10000 -j REJECT --reject-with icmp-port-unreachable
```

The chain it jumps to holds one logging rule and nothing that marks a packet
compliant, so every packet reaches the `REJECT`. Two things follow. Nothing in
either rule mentions a destination, so no address is treated differently from
any other. And the refusal is an **active ICMP port-unreachable** rather than a
silent drop — which is what lets the caller tell it apart from a destination
that simply is not there, and is the whole of the rehearsal below.

## Proving it, on a pod that never moves

Toggle the policy around an already-running probe. A freshly created pod is the
tempting shape and the unreliable one: the controller learns a new pod's labels
on its own schedule, so a pod that connects the instant it starts can be
refused for reasons that have nothing to do with the policy. Holding the pod
still leaves the policy as the only thing that changed.

The verdict and the timing come from a TCP connect; the reason comes from an
HTTP fetch at the same address, because that is the caller that reports *why*.

```sh
kubectl -n chuggy-work exec work-probe -- sh -c '
  for t in 169.254.169.254:80 10.43.0.1:443 10.43.0.10:53 1.1.1.1:443; do
    h="${t%%:*}"; p="${t##*:}"; s="$(date +%s)"
    if nc -w 3 "$h" "$p" </dev/null >/dev/null 2>&1; then v=open; else v=REFUSED; fi
    e="$(date +%s)"
    printf "tcp  %-20s %-8s %ss  %s\n" "$t" "$v" "$((e - s))" \
      "$(wget -T 3 -q -O /dev/null "http://$t/" 2>&1)"
  done
  s="$(date +%s)"
  d="$(nslookup -timeout=3 kubernetes.default.svc.cluster.local 2>&1 | tr "\n" " ")"
  e="$(date +%s)"
  printf "dns  %-20s %-8s %ss  %s\n" kubernetes.default - "$((e - s))" "$d"'
```

Before the policy, with the pod running and the address unchanged:

```
tcp  169.254.169.254:80   REFUSED  3s  wget: download timed out
tcp  10.43.0.1:443        open     0s  wget: server returned error: HTTP/1.0 400 Bad Request
tcp  10.43.0.10:53        open     0s  wget: download timed out
tcp  1.1.1.1:443          open     0s  wget: server returned error: HTTP/1.1 400 Bad Request
dns  kubernetes.default   -        0s  Server: 10.43.0.10 Address: 10.43.0.10:53   Name: kubernetes.default.svc.cluster.local Address: 10.43.0.1
```

With it applied:

```
tcp  169.254.169.254:80   REFUSED  1s  wget: can't connect to remote host (169.254.169.254): Connection refused
tcp  10.43.0.1:443        REFUSED  1s  wget: can't connect to remote host (10.43.0.1): Connection refused
tcp  10.43.0.10:53        REFUSED  1s  wget: can't connect to remote host (10.43.0.10): Connection refused
tcp  1.1.1.1:443          REFUSED  1s  wget: can't connect to remote host (1.1.1.1): Connection refused
dns  kubernetes.default   -        2s  nslookup: write to '10.43.0.10': Connection refused ;; connection timed out; no servers could be reached
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
says nothing: the caller waits out its timeout. After it, the same caller at
the same address is told **Connection refused** immediately — the ICMP
port-unreachable the `REJECT` above emits — in the same words, at the same
speed, as three addresses that were answering a moment earlier and have now
been refused by the same rule. The address did not change and nothing began
listening on it. The refusal is the policy's.

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
-A KUBE-POD-FW-GVN5Y6G7G75YPZCR -d 10.42.1.39/32 -m comment --comment "rule to permit the traffic traffic to pods when source is the pod\'s local node" -m addrtype --src-type LOCAL -j ACCEPT
```

So no NetworkPolicy in this cluster constrains a host-network workload in
either direction. Same namespace, same policy, same minute:

```
=== work-probe (pod network) ===
tcp  10.43.0.1:443        REFUSED  1s  wget: can't connect to remote host (10.43.0.1): Connection refused
tcp  1.1.1.1:443          REFUSED  1s  wget: can't connect to remote host (1.1.1.1): Connection refused
=== host-network-probe (host network) ===
tcp  10.43.0.1:443        open     0s  wget: server returned error: HTTP/1.0 400 Bad Request
tcp  1.1.1.1:443          open     0s  wget: server returned error: HTTP/1.1 400 Bad Request
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

`work-probe.yaml` sets `automountServiceAccountToken: false`, so the pod holds
no API credential:

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
