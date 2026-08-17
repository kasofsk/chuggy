# The public zone. Delegation is the operator's: the registrar has to be pointed
# at the name servers this zone is given, and that is not an API this
# configuration holds.

locals {
  dns_a_records = {
    desk = "${var.domain}."
    git  = "git.${var.domain}."
  }
}

resource "google_dns_managed_zone" "chug" {
  name        = var.name_prefix
  dns_name    = "${var.domain}."
  description = "Public zone for the deployment"

  depends_on = [google_project_service.enabled]
}

resource "google_dns_record_set" "a" {
  for_each = local.dns_a_records

  managed_zone = google_dns_managed_zone.chug.name
  name         = each.value
  type         = "A"
  ttl          = var.dns_ttl_seconds
  rrdatas      = [google_compute_address.ingress.address]
}
