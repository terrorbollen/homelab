terraform {
  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.30"
    }
  }

  # Same R2 bucket as terraform/cloudflare; see the comment there.
  backend "s3" {
    bucket                      = "homelab-backup"
    key                         = "tfstate/tailscale.tfstate"
    region                      = "auto"
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Reads the key from TAILSCALE_API_KEY
provider "tailscale" {}
