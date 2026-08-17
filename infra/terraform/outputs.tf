# What the rest of phase 0 reads. Every value here is an input to a command in
# infra/runbooks/phase-0.md; nothing is output for the look of it.

output "controlplane_ip" {
  description = "Static external address of the control plane, and the endpoint talosctl and kubectl reach"
  value       = google_compute_address.controlplane.address
}

output "ingress_ip" {
  description = "Static external address the load balancer answers on"
  value       = google_compute_address.ingress.address
}

output "dns_name_servers" {
  description = "Name servers the registrar has to be pointed at before the zone resolves"
  value       = google_dns_managed_zone.chug.name_servers
}

output "bucket_names" {
  description = "Bucket names, keyed by the suffix they were declared under"
  value       = { for key, bucket in google_storage_bucket.bucket : key => bucket.name }
}

output "workload_identity_provider" {
  description = "Full resource name of the OIDC provider, which every workload's credential configuration names"
  value       = google_iam_workload_identity_pool_provider.cluster.name
}

output "oidc_issuer_uri" {
  description = "The issuer the API server advertises and the provider trusts, which gen-config is given"
  value       = local.oidc_issuer_uri
}

output "oidc_audience" {
  description = "Audience a projected token must carry, which every pod mounting one names"
  value       = var.oidc_audience
}

output "workload_service_account_emails" {
  description = "Cloud account each workload impersonates, keyed by workload"
  value       = { for key, account in google_service_account.workload : key => account.email }
}

output "artifact_registry_host" {
  description = "Registry host images are tagged against"
  value       = "${google_artifact_registry_repository.images.location}-docker.pkg.dev"
}
