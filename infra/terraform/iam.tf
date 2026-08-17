# One cloud identity per workload, impersonable only by the one Kubernetes
# service account named beside it, through federation against the cluster's own
# OIDC issuer. No key file is ever issued, so there is nothing to leak and
# nothing to rotate.
#
# The CSI driver sits in its own namespace because that is where its upstream
# manifests put it; every other workload is the deployment's own.

locals {
  oidc_issuer_uri = "https://storage.googleapis.com/${google_storage_bucket.bucket["oidc"].name}"

  workload_service_accounts = {
    dispatcher = { namespace = var.kubernetes_namespace, name = "dispatcher" }
    litestream = { namespace = var.kubernetes_namespace, name = "litestream" }
    gitbackup  = { namespace = var.kubernetes_namespace, name = "git-backup" }
    etcdbackup = { namespace = var.kubernetes_namespace, name = "etcd-backup" }
    imagebuild = { namespace = var.kubernetes_namespace, name = "image-build" }
    csi        = { namespace = var.csi_namespace, name = var.csi_service_account }
  }

  # Which bucket each workload owns objects in. A workload absent here reaches
  # no bucket at all.
  bucket_object_admins = {
    dispatcher = "artifacts"
    litestream = "journal-replica"
    gitbackup  = "git-backup"
    etcdbackup = "etcd-backup"
  }

  csi_member = "serviceAccount:${google_service_account.workload["csi"].email}"
}

resource "google_service_account" "workload" {
  for_each = local.workload_service_accounts

  account_id   = "${var.name_prefix}-${each.key}"
  display_name = "Workload identity for ${each.key}"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool" "cluster" {
  workload_identity_pool_id = "${var.name_prefix}-k8s"
  display_name              = "Chuggy cluster"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "cluster" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.cluster.workload_identity_pool_id
  workload_identity_pool_provider_id = "${var.name_prefix}-cluster"

  # `sub` is `system:serviceaccount:<namespace>:<name>`, which is what the
  # bindings below match on. Nothing else about the token is trusted.
  attribute_mapping = {
    "google.subject" = "assertion.sub"
  }

  oidc {
    issuer_uri        = local.oidc_issuer_uri
    allowed_audiences = [var.oidc_audience]
  }
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each = local.workload_service_accounts

  service_account_id = google_service_account.workload[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.cluster.name}/subject/system:serviceaccount:${each.value.namespace}:${each.value.name}"
}

resource "google_storage_bucket_iam_member" "workload_object_admin" {
  for_each = local.bucket_object_admins

  bucket = google_storage_bucket.bucket[each.value].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.workload[each.key].email}"
}

# The dispatcher mints per-job credentials from user secrets, and those alone:
# the condition confines it to secrets whose name carries the user prefix, so a
# deployment secret in the same project is out of its reach.
resource "google_project_iam_member" "dispatcher_user_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.workload["dispatcher"].email}"

  condition {
    title      = "user secrets only"
    expression = "resource.name.extract('/secrets/{secret}').startsWith('${var.user_secret_prefix}')"
  }
}

resource "google_artifact_registry_repository_iam_member" "imagebuild_push" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.workload["imagebuild"].email}"
}

# The CSI driver's two grants. Acting on disks is project-wide because a disk it
# has not created yet has no resource to scope against; acting as a service
# account is not, because the only account it ever attaches a disk on behalf of
# is the node's. At project scope that second role would carry actAs on every
# account here, the dispatcher's among them.
resource "google_project_iam_member" "csi_disks" {
  project = var.project_id
  role    = "roles/compute.storageAdmin"
  member  = local.csi_member
}

resource "google_service_account_iam_member" "csi_acts_as_node" {
  service_account_id = google_service_account.node.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.csi_member
}
