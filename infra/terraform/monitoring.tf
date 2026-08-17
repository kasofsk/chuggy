# The one check that lives outside the cluster, because a dead cluster cannot
# report itself dead. The policy is what makes it a control: an uptime check
# with no policy behind it is a graph nobody is watching.

resource "google_monitoring_notification_channel" "operator" {
  display_name = "Operator email"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_uptime_check_config" "desk" {
  display_name = "Desk health"
  timeout      = "${var.uptime_timeout_seconds}s"
  period       = "${var.uptime_period_seconds}s"

  http_check {
    path         = var.desk_health_path
    port         = var.ingress_https_port
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = var.domain
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "desk_unreachable" {
  display_name = "Desk unreachable"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.desk.uptime_check_id}\"",
      ])

      # More than one probing location reporting a failure. The window and the
      # aligner are the Monitoring API's own shape for an uptime condition, not
      # a choice this deployment makes.
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.operator.id]
}
