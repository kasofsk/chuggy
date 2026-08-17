# External passthrough Network Load Balancer, in its backend-service form; the
# target-pool form is the deprecated predecessor and its health check is a
# legacy resource.
#
# Passthrough does not rewrite the port, so the ingress controller listens on
# the node's own HTTP and HTTPS ports rather than on a NodePort.
#
# UNVERIFIED, and it belongs to whoever installs that controller: passthrough
# does not rewrite the destination address either, so a packet arrives at the
# node addressed to the balancer's address. A stock GCE image accepts it because
# its guest agent programs that address from instance metadata, and Talos runs
# no such agent. Cilium's own service handling is the other candidate, and it
# wants a Service frontend rather than a host port. Nothing here settles which,
# and the closing section of infra/runbooks/phase-0.md carries the check that
# does.

resource "google_compute_address" "ingress" {
  name   = "${var.name_prefix}-ingress-ip"
  region = var.region

  depends_on = [google_project_service.enabled]
}

resource "google_compute_region_health_check" "ingress" {
  name   = "${var.name_prefix}-ingress-health"
  region = var.region

  http_health_check {
    port         = var.ingress_health_port
    request_path = var.ingress_health_path
  }

  depends_on = [google_project_service.enabled]
}

resource "google_compute_region_backend_service" "ingress" {
  name                  = "${var.name_prefix}-ingress"
  region                = var.region
  protocol              = "TCP"
  load_balancing_scheme = "EXTERNAL"
  health_checks         = [google_compute_region_health_check.ingress.id]

  backend {
    group = google_compute_instance_group.ingress.self_link
  }
}

resource "google_compute_forwarding_rule" "ingress" {
  name                  = "${var.name_prefix}-ingress"
  region                = var.region
  load_balancing_scheme = "EXTERNAL"
  ip_address            = google_compute_address.ingress.address
  ip_protocol           = "TCP"
  ports                 = [var.ingress_http_port, var.ingress_https_port]
  backend_service       = google_compute_region_backend_service.ingress.id
}
