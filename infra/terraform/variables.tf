# Every deployment choice this configuration makes. A variable with no default
# is one nothing here can guess safely.

variable "project_id" {
  description = "The GCP project the deployment owns outright"
  type        = string
  default     = "chuggy-prod"
}

variable "region" {
  description = "The region every regional resource lives in"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The zone the nodes live in; one zone, because the control plane is single"
  type        = string
  default     = "us-central1-a"
}

variable "name_prefix" {
  description = "Prefix on every resource name in the project"
  type        = string
  default     = "chuggy"
}

variable "bucket_prefix" {
  description = "Prefix on bucket names, which are unique across all of GCS rather than within the project"
  type        = string
  default     = "chuggy"
}

variable "domain" {
  description = "The zone apex, and the desk's own name"
  type        = string
  default     = "chug.kasofsk.xyz"
}

variable "dns_ttl_seconds" {
  description = "Record TTL; low enough that a cutover is not an afternoon"
  type        = number
  default     = 300
}

variable "subnet_cidr" {
  description = "The single node subnet"
  type        = string
  default     = "10.10.0.0/20"
}

variable "operator_cidr" {
  description = "Where the Kubernetes and Talos APIs may be reached from. No default: a guess here is a public control plane"
  type        = string
}

variable "talos_image" {
  description = "Self link or name of the Talos GCE image the operator built and uploaded"
  type        = string
}

variable "work_node_count" {
  description = "Machines in the work pool"
  type        = number
  default     = 1
}

variable "machine_type_controlplane" {
  description = "Machine type for the control plane"
  type        = string
  default     = "e2-standard-2"
}

variable "machine_type_system" {
  description = "Machine type for the system pool"
  type        = string
  default     = "e2-standard-4"
}

variable "machine_type_work" {
  description = "Machine type for the work pool"
  type        = string
  default     = "e2-standard-8"
}

variable "boot_disk_size_gb" {
  description = "Boot disk on every node"
  type        = number
  default     = 50
}

variable "lb_backend_pools" {
  description = "Pools whose nodes join the load balancer's backend, being the pools that run the ingress controller"
  type        = list(string)
  default     = ["system"]
}

variable "ingress_http_port" {
  description = "Port the ingress controller serves HTTP on, unchanged from client to node through a passthrough balancer"
  type        = number
  default     = 80
}

variable "ingress_https_port" {
  description = "Port the ingress controller serves HTTPS on"
  type        = number
  default     = 443
}

variable "ingress_health_port" {
  description = "Port the ingress controller answers health probes on"
  type        = number
  default     = 10254
}

variable "ingress_health_path" {
  description = "Path the ingress controller answers health probes on"
  type        = string
  default     = "/healthz"
}

variable "desk_health_path" {
  description = "Path the desk answers the outside uptime check on"
  type        = string
  default     = "/healthz"
}

variable "buckets" {
  description = "Every bucket, keyed by the suffix its name carries"
  type = map(object({
    versioned                 = optional(bool, false)
    noncurrent_retention_days = optional(number, 0)
    public_read               = optional(bool, false)
    dual_region               = optional(bool, false)
  }))
  # Versioning is the net under a delete, and the retention is what stops that
  # net growing without end; a bucket that has one has the other. The three that
  # hold a restore carry both. The other two carry neither and for the same
  # reason: an artifact is rebuildable from the ticket that produced it, and the
  # OIDC documents are re-published from the cluster by a runbook step.
  default = {
    "journal-replica" = { versioned = true, noncurrent_retention_days = 90, dual_region = true }
    "git-backup"      = { versioned = true, noncurrent_retention_days = 90 }
    "etcd-backup"     = { versioned = true, noncurrent_retention_days = 90 }
    "artifacts"       = {}
    "oidc"            = { public_read = true }
  }
}

variable "dual_region_multi_region" {
  description = "The multi-region a configurable dual-region bucket is placed within"
  type        = string
  default     = "US"
}

variable "dual_region_locations" {
  description = "The two regions a dual-region bucket replicates across"
  type        = list(string)
  default     = ["US-CENTRAL1", "US-EAST1"]
}

variable "kubernetes_namespace" {
  description = "Namespace the deployment's own workloads run in"
  type        = string
  default     = "chuggy-system"
}

variable "csi_namespace" {
  description = "Namespace the GCE PD CSI driver's upstream manifests install into"
  type        = string
  default     = "gce-pd-csi-driver"
}

variable "csi_service_account" {
  description = "Kubernetes service account the PD CSI controller runs as"
  type        = string
  default     = "csi-gce-pd-controller-sa"
}

variable "oidc_audience" {
  description = "Audience a projected service-account token must carry to be exchanged. The API server's api-audiences must include it"
  type        = string
  default     = "chuggy-workload-identity"
}

variable "user_secret_prefix" {
  description = "Name prefix marking a secret as a user's credential, which is the only kind the dispatcher may read"
  type        = string
  default     = "user-"
}

variable "alert_email" {
  description = "Where the uptime alert goes. No default: an alert nobody receives is not an alert"
  type        = string
}

variable "uptime_timeout_seconds" {
  description = "How long a probe waits for the desk"
  type        = number
  default     = 10
}

variable "uptime_period_seconds" {
  description = "How often the desk is probed"
  type        = number
  default     = 300
}
