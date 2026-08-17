# The project services every other file here depends on, and says so: each root
# resource carries an explicit `depends_on` back to this one, because Terraform
# reads no dependency from the fact that a resource needs an API. Without them
# the graph is free to create a bucket before storage is enabled.
#
# Disabling on destroy is off: the services are the project's, not this
# configuration's, and a destroy that switched them off would take anything else
# in the project with it.

resource "google_project_service" "enabled" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
