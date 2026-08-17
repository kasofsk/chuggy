# One VPC, one subnet, egress through Cloud NAT. Only the control plane carries
# a public address, so NAT is how every other node reaches the registry.
#
# The network tags are declared here rather than beside the instances that wear
# them: a tag means whatever the firewall says it means, and nothing else.

locals {
  tag_node         = "${var.name_prefix}-node"
  tag_controlplane = "${var.name_prefix}-controlplane"
  tag_ingress      = "${var.name_prefix}-ingress"

  # Fixed ports of the software that runs on a node.
  port_kubernetes_api = "6443"
  port_talos          = "50000-50001"
  port_talos_api      = "50000"
  port_etcd           = "2379-2380"
  port_kubelet        = "10250"
  port_cilium_health  = "4240"
  port_cilium_vxlan   = "8472"

  # Google's health-check probers and its IAP forwarders, both of which reach a
  # node from outside the VPC.
  health_check_ranges = ["35.191.0.0/16", "209.85.152.0/22", "209.85.204.0/22"]
  iap_ranges          = ["35.235.240.0/20"]

  firewall_tcp = {
    operator = {
      description   = "Kubernetes and Talos APIs, from the operator only"
      source_ranges = [var.operator_cidr]
      target_tags   = [local.tag_controlplane]
      ports         = [local.port_kubernetes_api, local.port_talos_api]
    }
    ingress = {
      description   = "Public HTTP and HTTPS, arriving unchanged through the passthrough load balancer"
      source_ranges = ["0.0.0.0/0"]
      target_tags   = [local.tag_ingress]
      ports         = [tostring(var.ingress_http_port), tostring(var.ingress_https_port)]
    }
    healthcheck = {
      description   = "Load-balancer health probes"
      source_ranges = local.health_check_ranges
      target_tags   = [local.tag_ingress]
      ports         = [tostring(var.ingress_health_port)]
    }
    iap = {
      description   = "Talos API through Identity-Aware Proxy, which is how a node carrying no public address is configured at all"
      source_ranges = local.iap_ranges
      target_tags   = [local.tag_node]
      ports         = [local.port_talos_api]
    }
  }
}

resource "google_compute_network" "vpc" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

resource "google_compute_subnetwork" "nodes" {
  name                     = "${var.name_prefix}-nodes"
  network                  = google_compute_network.vpc.id
  region                   = var.region
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_router" "nat" {
  name    = "${var.name_prefix}-nat-router"
  network = google_compute_network.vpc.id
  region  = var.region
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.name_prefix}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_firewall" "tcp" {
  for_each = local.firewall_tcp

  name          = "${var.name_prefix}-allow-${each.key}"
  description   = each.value.description
  network       = google_compute_network.vpc.name
  direction     = "INGRESS"
  source_ranges = each.value.source_ranges
  target_tags   = each.value.target_tags

  allow {
    protocol = "tcp"
    ports    = each.value.ports
  }
}

# Node to node, and only from the subnet: the API server, etcd, the Talos API
# between machines, the kubelet, and Cilium's overlay and health probes. The
# API server is on this list because a custom-mode VPC denies what it does not
# allow, and a worker that cannot reach it never registers.
resource "google_compute_firewall" "internal" {
  name          = "${var.name_prefix}-allow-internal"
  network       = google_compute_network.vpc.name
  direction     = "INGRESS"
  source_ranges = [var.subnet_cidr]
  target_tags   = [local.tag_node]

  allow {
    protocol = "tcp"
    ports = [
      local.port_kubernetes_api,
      local.port_etcd,
      local.port_talos,
      local.port_kubelet,
      local.port_cilium_health,
    ]
  }

  allow {
    protocol = "udp"
    ports    = [local.port_cilium_vxlan]
  }
}
