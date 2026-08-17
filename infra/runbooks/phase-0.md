# Phase 0 — the GCP foundation and the Talos cluster

Every step here is the operator's to run, from a machine holding owner on the
project. Nothing in this repository applies any of it, and nothing here has been
run.

The ticket is kasofsk/chuggy#75. The decisions are argued in
`docs/design/012-the-cluster.md` and `docs/design/015-backups-and-monitoring.md`.

The operator's machine needs `gcloud`, `terraform`, `talosctl`, `kubectl`,
`helm`, `jq` and `docker`. Placeholders are written `<LIKE_THIS>` and have to be
filled in.

## 1. Project and billing

```sh
export CHUGGY_PROJECT=chuggy-prod
export CHUGGY_REGION=us-central1
export CHUGGY_ZONE=us-central1-a

gcloud projects create "$CHUGGY_PROJECT"
gcloud billing projects link "$CHUGGY_PROJECT" --billing-account=<BILLING_ACCOUNT_ID>
gcloud config set project "$CHUGGY_PROJECT"
```

Terraform enables the rest of the services it needs. These two come first
because the state bucket and the Talos image are made before Terraform runs.

```sh
gcloud services enable compute.googleapis.com storage.googleapis.com
```

## 2. The state bucket, by hand

A backend block takes no variables, so the bucket name is a literal in
`infra/terraform/backend.tf` and this bucket is not in the configuration that
stores its state there.

```sh
gcloud storage buckets create gs://chuggy-tfstate \
  --location="$CHUGGY_REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update gs://chuggy-tfstate --versioning
```

## 3. The Talos image

Pick a Talos release and pin it; the same version pins the `talosctl` used for
the rest of this runbook. The floor is whatever release carries `machine.nodeTaints`,
`machine.features.kubernetesTalosAPIAccess` and KubePrism, all three of which the
patches under `infra/talos` use; check the release notes rather than assuming a
current release has them.

```sh
export TALOS_VERSION=<TALOS_RELEASE_TAG>
export TALOS_IMAGE_NAME=<TALOS_IMAGE_NAME>

curl -fsSLO "https://github.com/siderolabs/talos/releases/download/${TALOS_VERSION}/gcp-amd64.raw.tar.gz"
gcloud storage cp gcp-amd64.raw.tar.gz "gs://chuggy-tfstate/images/${TALOS_VERSION}.tar.gz"

gcloud compute images create "$TALOS_IMAGE_NAME" \
  --source-uri="gs://chuggy-tfstate/images/${TALOS_VERSION}.tar.gz" \
  --guest-os-features=UEFI_COMPATIBLE
```

## 4. Terraform

The first `init` writes `.terraform.lock.hcl`; commit it, so every later apply
resolves the same provider.

```sh
cd infra/terraform
terraform init
terraform apply \
  -var="talos_image=$TALOS_IMAGE_NAME" \
  -var="operator_cidr=<OPERATOR_CIDR>" \
  -var="alert_email=<OPERATOR_EMAIL>"
```

Service enablement propagates behind the API that reports it done, so a first
apply on a fresh project can fail naming a service it just enabled. Re-run the
same apply.

`operator_cidr` is the only range the Kubernetes and Talos APIs answer on, so a
change of address is a re-apply.

The workload identity provider names an issuer that nothing serves yet, because
the cluster it belongs to does not exist. If the provider is refused for a
discovery document it could not reach, apply everything else, come back after
step 10 and apply again:

```sh
terraform apply -target=google_iam_workload_identity_pool_provider.cluster
```

Keep the outputs to hand:

```sh
terraform output
export CONTROLPLANE_IP="$(terraform output -raw controlplane_ip)"
export WIF_PROVIDER="$(terraform output -raw workload_identity_provider)"
export OIDC_ISSUER="$(terraform output -raw oidc_issuer_uri)"
cd ../..
```

## 5. Delegate the zone

Point the registrar at the name servers the zone was given. Nothing in this
phase blocks on it, but the uptime check stays red and the certificate issuance
in the next phase cannot start until it resolves.

```sh
gcloud dns managed-zones describe chuggy --format="value(nameServers)"
dig +short NS chug.kasofsk.xyz
```

## 6. Generate the machine configurations

The secrets bundle is generated once and is the cluster's root of trust. It
never enters this repository.

```sh
talosctl gen secrets --output-file secrets.yaml

talosctl gen config chuggy "https://${CONTROLPLANE_IP}:6443" \
  --output-dir _out \
  --with-secrets secrets.yaml \
  --additional-sans "$CONTROLPLANE_IP" \
  --config-patch @infra/talos/common.patch.yaml \
  --config-patch-control-plane @infra/talos/controlplane.patch.yaml
```

`infra/talos/controlplane.patch.yaml` carries the issuer, the JWKS URI and the
audiences. Check them against `$OIDC_ISSUER` and against `oidc_audience` in
`infra/terraform/variables.tf` before applying: the patch is static YAML and
cannot read Terraform.

```sh
talosctl validate --config _out/controlplane.yaml --mode cloud
talosctl validate --config _out/worker.yaml --mode cloud
```

## 7. The secrets bundle into Secret Manager

The name carries no `user-` prefix, so the dispatcher's grant does not reach it.

```sh
gcloud secrets create talos-secrets --replication-policy=automatic
gcloud secrets versions add talos-secrets --data-file=secrets.yaml
rm secrets.yaml
```

## 8. Apply the configurations

The control plane answers on its own address. The system and work nodes carry no
public address, so they are reached through IAP.

```sh
talosctl apply-config --insecure --nodes "$CONTROLPLANE_IP" \
  --file _out/controlplane.yaml
```

For each node in the system pool, and then each in the work pool:

```sh
gcloud compute instances list --filter="name~^chuggy-" \
  --format="table(name,networkInterfaces[0].networkIP)"

gcloud compute start-iap-tunnel <NODE_NAME> 50000 \
  --local-host-port=localhost:50000 --zone="$CHUGGY_ZONE" &

talosctl apply-config --insecure --nodes 127.0.0.1 \
  --file _out/worker.yaml \
  --config-patch @infra/talos/system.patch.yaml

kill %1
```

Work-pool nodes take `@infra/talos/work.patch.yaml` in place of the system
patch.

## 9. Bootstrap

Run once, against the control plane only.

```sh
export TALOSCONFIG="$PWD/_out/talosconfig"
talosctl config endpoint "$CONTROLPLANE_IP"
talosctl config node "$CONTROLPLANE_IP"

talosctl bootstrap
talosctl kubeconfig .
export KUBECONFIG="$PWD/kubeconfig"
```

Nodes stay NotReady until Cilium is installed; that is the CNI being absent, not
a fault.

If the control plane does not come up, read the logs before anything else:

```sh
talosctl logs controller-runtime | grep -i apiserver
talosctl containers --kubernetes
```

`talosctl validate` checks the shape of a machine config, not whether Talos will
accept an argument it also sets for itself. The control-plane patch overrides
three of the API server's: `service-account-issuer`, `service-account-jwks-uri`
and `api-audiences`. A rejected or duplicated argument shows up here as an API
server that never starts. The fix is that release's documented field for the
argument in place of `extraArgs`; the values do not change.

## 10. Publish the OIDC discovery document and the JWKS

Until this lands in the bucket, Google cannot verify a token the cluster issued,
so every workload identity below fails closed.

```sh
kubectl get --raw /.well-known/openid-configuration > openid-configuration
kubectl get --raw /openid/v1/jwks > jwks

gcloud storage cp openid-configuration \
  gs://chuggy-oidc/.well-known/openid-configuration \
  --content-type=application/json --cache-control="public, max-age=300"
gcloud storage cp jwks \
  gs://chuggy-oidc/openid/v1/jwks \
  --content-type=application/jwk-set+json --cache-control="public, max-age=300"
```

Confirm the published issuer is the one the provider trusts:

```sh
curl -fsS "${OIDC_ISSUER}/.well-known/openid-configuration"
curl -fsS "${OIDC_ISSUER}/openid/v1/jwks"
```

Re-run this step after any control-plane certificate rotation.

## 11. Cilium

kube-proxy is disabled in the control-plane patch, so Cilium replaces it and
reaches the API server through Talos's local endpoint rather than through a
Service.

```sh
helm repo add cilium https://helm.cilium.io/
helm repo update

helm install cilium cilium/cilium --namespace kube-system \
  --set ipam.mode=kubernetes \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=localhost \
  --set k8sServicePort=7445 \
  --set routingMode=tunnel \
  --set tunnelProtocol=vxlan \
  --set cgroup.autoMount.enabled=false \
  --set cgroup.hostRoot=/sys/fs/cgroup \
  --set securityContext.capabilities.ciliumAgent="{CHOWN,KILL,NET_ADMIN,NET_RAW,IPC_LOCK,SYS_ADMIN,SYS_RESOURCE,DAC_OVERRIDE,FOWNER,SETGID,SETUID}" \
  --set securityContext.capabilities.cleanCiliumState="{NET_ADMIN,SYS_ADMIN,SYS_RESOURCE}"

kubectl -n kube-system rollout status daemonset/cilium
kubectl get nodes
```

The overlay protocol here is what the internal firewall rule opens; changing one
means changing the other.

## 12. The PD CSI driver, on workload identity

The driver holds no key file. Its credential configuration names a projected
token the kubelet mints, and the exchange happens against the pool.

```sh
export CSI_SA="$(terraform -chdir=infra/terraform output -json workload_service_account_emails | jq -r .csi)"
export OIDC_AUDIENCE="$(terraform -chdir=infra/terraform output -raw oidc_audience)"

gcloud iam workload-identity-pools create-cred-config "$WIF_PROVIDER" \
  --service-account="$CSI_SA" \
  --credential-source-file=/var/run/secrets/gcp/token \
  --credential-source-type=text \
  --output-file=csi-cred-config.json

kubectl create namespace gce-pd-csi-driver
kubectl -n gce-pd-csi-driver create secret generic cloud-sa \
  --from-file=cloud-sa.json=csi-cred-config.json

kubectl apply -k "github.com/kubernetes-sigs/gcp-compute-persistent-disk-csi-driver/deploy/kubernetes/overlays/stable-master?ref=<DRIVER_RELEASE_TAG>"
```

The controller has to be given the token the credential configuration reads:

```sh
kubectl -n gce-pd-csi-driver patch deployment csi-gce-pd-controller \
  --type=strategic --patch "$(cat <<PATCH
spec:
  template:
    spec:
      volumes:
        - name: gcp-token
          projected:
            sources:
              - serviceAccountToken:
                  path: token
                  audience: ${OIDC_AUDIENCE}
                  expirationSeconds: 3600
      containers:
        - name: gce-pd-driver
          volumeMounts:
            - name: gcp-token
              mountPath: /var/run/secrets/gcp
              readOnly: true
PATCH
)"
```

A storage class, so a claim has something to bind against:

```sh
kubectl apply -f - <<'CLASS'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: pd-balanced
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: pd.csi.storage.gke.io
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
parameters:
  type: pd-balanced
CLASS
```

## 13. The verifications

The first two have everything they need and phase 0 is not done until both pass.
The third is a check on something nothing here configures; read its step before
running it.

### Workload identity token exchange

```sh
kubectl create namespace chuggy-system
kubectl -n chuggy-system create serviceaccount dispatcher

export DISPATCHER_SA="$(terraform -chdir=infra/terraform output -json workload_service_account_emails | jq -r .dispatcher)"
gcloud iam workload-identity-pools create-cred-config "$WIF_PROVIDER" \
  --service-account="$DISPATCHER_SA" \
  --credential-source-file=/var/run/secrets/gcp/token \
  --credential-source-type=text \
  --output-file=dispatcher-cred-config.json
kubectl -n chuggy-system create configmap gcp-cred --from-file=config.json=dispatcher-cred-config.json

kubectl -n chuggy-system apply -f - <<POD
apiVersion: v1
kind: Pod
metadata:
  name: wif-check
spec:
  serviceAccountName: dispatcher
  restartPolicy: Never
  containers:
    - name: sdk
      image: google/cloud-sdk:slim
      command: ["sh", "-c"]
      args:
        - gcloud auth login --cred-file=/etc/gcp/config.json &&
          gcloud storage ls gs://chuggy-artifacts
      volumeMounts:
        - name: gcp-token
          mountPath: /var/run/secrets/gcp
        - name: gcp-cred
          mountPath: /etc/gcp
  volumes:
    - name: gcp-token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              audience: ${OIDC_AUDIENCE}
              expirationSeconds: 3600
    - name: gcp-cred
      configMap:
        name: gcp-cred
POD

kubectl -n chuggy-system logs -f pod/wif-check
```

The pod exits zero having listed the bucket. A failure that names the audience
or the issuer is step 10 not having landed.

### Persistent disk provisioning

```sh
kubectl apply -f - <<'CLAIM'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pd-check
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
  storageClassName: pd-balanced
CLAIM

kubectl run pd-check --image=busybox --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"v","persistentVolumeClaim":{"claimName":"pd-check"}}],"containers":[{"name":"pd-check","image":"busybox","command":["sh","-c","echo ok > /v/ok; cat /v/ok"],"volumeMounts":[{"name":"v","mountPath":"/v"}]}]}}'

kubectl get pvc pd-check
kubectl logs pod/pd-check
```

The claim reaches Bound and the pod reads back what it wrote.

### Kubelet pull from Artifact Registry

**No credential mechanism is configured for this, anywhere.** The node service
account holds `roles/artifactregistry.reader`, and nothing turns that grant into
a token the kubelet presents: the Talos patches carry no
`machine.registries.config` and no kubelet image credential provider. This step
is therefore a finding-out, not a confirmation, and it is expected to fail until
one of the two is chosen.

The candidates are `machine.registries.config` with a static credential, which
is simple and needs a rotation story because an Artifact Registry token is
short-lived; and a kubelet image credential provider, which needs the provider
binary present on a Talos node. Settle on one, land it as a patch under
`infra/talos`, and record the choice on kasofsk/chuggy#75 — it is that ticket's
third verification.

Push an image by hand, then run it on each pool.

```sh
export REGISTRY="$(terraform -chdir=infra/terraform output -raw artifact_registry_host)"
gcloud auth configure-docker "$REGISTRY"

docker pull busybox:latest
docker tag busybox:latest "${REGISTRY}/${CHUGGY_PROJECT}/chuggy/pull-check:1"
docker push "${REGISTRY}/${CHUGGY_PROJECT}/chuggy/pull-check:1"

kubectl run pull-check --image="${REGISTRY}/${CHUGGY_PROJECT}/chuggy/pull-check:1" \
  --restart=Never --command -- true
kubectl get pod pull-check -o wide
```

The pod reaches Completed with no `ImagePullBackOff`, on a node whose only cloud
identity is the node service account. That run lands on the system pool. The
work pool carries the taint, so it needs its own:

```sh
kubectl run pull-check-work --image="${REGISTRY}/${CHUGGY_PROJECT}/chuggy/pull-check:1" \
  --restart=Never --command \
  --overrides='{"spec":{"nodeSelector":{"chuggy.io/pool":"work"},"tolerations":[{"key":"chuggy.io/pool","value":"work","effect":"NoSchedule"}]}}' \
  -- true
kubectl get pod pull-check-work -o wide
```

## 14. Tear down the scratch

The claim's pod goes before the claim: while a pod still mounts it, the
protection finalizer holds the claim in Terminating and nothing moves.

```sh
kubectl -n chuggy-system delete pod wif-check
kubectl -n chuggy-system delete configmap gcp-cred
kubectl delete pod pull-check pull-check-work pd-check
kubectl delete pvc pd-check
rm -f dispatcher-cred-config.json csi-cred-config.json gcp-amd64.raw.tar.gz
gcloud storage rm "gs://chuggy-tfstate/images/${TALOS_VERSION}.tar.gz"
```

## What phase 0 leaves for the next one

- The load balancer's backend stays unhealthy and the uptime alert stays firing
  until an ingress controller listens on the node's own HTTP and HTTPS ports.
  Whoever installs it owns one check this phase cannot make, because a
  passthrough balancer hands the node a packet still addressed to the balancer:

  ```sh
  export INGRESS_IP="$(terraform -chdir=infra/terraform output -raw ingress_ip)"
  gcloud compute backend-services get-health chuggy-ingress --region="$CHUGGY_REGION"
  curl -sS -o /dev/null -w '%{http_code}\n' "http://${INGRESS_IP}/"
  ```

  A healthy backend with a curl that hangs is the node dropping a packet it was
  never told to accept, and `infra/terraform/lb.tf` names the two candidates.
- The `chuggy-jobs` namespace, its default-deny egress policy and its
  metadata-server denial are applied once that namespace exists.
- The etcd snapshot schedule uses the Talos API access the control-plane patch
  grants; the patch is here, the schedule is not.
