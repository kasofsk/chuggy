# Terraform's own configuration. A backend block takes no variables, so the
# state bucket is a literal here and is created by hand before the first init
# — see infra/runbooks/phase-0.md. Nothing in this configuration creates it.

terraform {
  required_version = ">= 1.3"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "chuggy-tfstate"
    prefix = "p0"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
