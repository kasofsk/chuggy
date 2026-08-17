resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.name_prefix
  format        = "DOCKER"
  description   = "Images this deployment builds and the cluster pulls"

  depends_on = [google_project_service.enabled]
}
