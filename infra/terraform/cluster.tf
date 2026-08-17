# The Talos machines. A node boots into maintenance mode and takes its
# configuration over the Talos API from the operator's machine, so nothing here
# carries a startup script or a config in metadata — a machine config holds the
# cluster's certificates, and instance metadata is readable by anything on the
# instance.

locals {
  node_pools = {
    controlplane = {
      machine_type = var.machine_type_controlplane
      node_count   = 1
      external     = true
      tags         = [local.tag_node, local.tag_controlplane]
    }
    system = {
      machine_type = var.machine_type_system
      node_count   = 1
      external     = false
      tags         = [local.tag_node, local.tag_ingress]
    }
    work = {
      machine_type = var.machine_type_work
      node_count   = var.work_node_count
      external     = false
      tags         = [local.tag_node]
    }
  }

  nodes = merge([
    for pool, spec in local.node_pools : {
      for index in range(spec.node_count) :
      "${pool}-${index + 1}" => merge(spec, { pool = pool })
    }
  ]...)
}

resource "google_compute_address" "controlplane" {
  name   = "${var.name_prefix}-controlplane-ip"
  region = var.region

  depends_on = [google_project_service.enabled]
}

# The only cloud identity a node holds. Everything a workload needs it federates
# for itself (iam.tf), so a container escape onto a node buys a registry pull.
resource "google_service_account" "node" {
  account_id   = "${var.name_prefix}-node"
  display_name = "Talos node"

  depends_on = [google_project_service.enabled]
}

resource "google_artifact_registry_repository_iam_member" "node_pull" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.node.email}"
}

resource "google_compute_instance" "node" {
  for_each = local.nodes

  name         = "${var.name_prefix}-${each.key}"
  machine_type = each.value.machine_type
  zone         = var.zone
  tags         = each.value.tags

  boot_disk {
    initialize_params {
      image = var.talos_image
      size  = var.boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.nodes.id

    dynamic "access_config" {
      for_each = each.value.external ? [google_compute_address.controlplane.address] : []
      content {
        nat_ip = access_config.value
      }
    }
  }

  service_account {
    email  = google_service_account.node.email
    scopes = ["cloud-platform"]
  }

  allow_stopping_for_update = true
}

# The load balancer's backend. Membership follows the pools that run the ingress
# controller: a node in this group that never serves ingress is a health check
# that fails forever.
resource "google_compute_instance_group" "ingress" {
  name = "${var.name_prefix}-ingress"
  zone = var.zone

  instances = [
    for key, node in local.nodes : google_compute_instance.node[key].self_link
    if contains(var.lb_backend_pools, node.pool)
  ]
}
