# Every bucket the deployment holds, from one shape. Uniform bucket-level access
# everywhere, so access is IAM's alone and no object carries its own ACL.
#
# One bucket is world-readable, and deliberately: it publishes the cluster's
# OIDC discovery document and its JWKS, which is what lets Google federate a
# Kubernetes service account (iam.tf). Public access prevention is enforced on
# every other bucket, so widening one is a visible edit here.

resource "google_storage_bucket" "bucket" {
  for_each = var.buckets

  name     = "${var.bucket_prefix}-${each.key}"
  project  = var.project_id
  location = each.value.dual_region ? var.dual_region_multi_region : upper(var.region)

  uniform_bucket_level_access = true
  public_access_prevention    = each.value.public_read ? "inherited" : "enforced"

  versioning {
    enabled = each.value.versioned
  }

  dynamic "custom_placement_config" {
    for_each = each.value.dual_region ? [var.dual_region_locations] : []
    content {
      data_locations = custom_placement_config.value
    }
  }

  dynamic "lifecycle_rule" {
    for_each = each.value.noncurrent_retention_days > 0 ? [each.value.noncurrent_retention_days] : []
    content {
      condition {
        days_since_noncurrent_time = lifecycle_rule.value
        with_state                 = "ARCHIVED"
      }
      action {
        type = "Delete"
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "oidc_public" {
  bucket = google_storage_bucket.bucket["oidc"].name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
