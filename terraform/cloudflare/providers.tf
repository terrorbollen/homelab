terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State lives in R2. Credentials and the endpoint come from the environment
  # (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3) because
  # the endpoint contains the account ID and the repo is public.
  backend "s3" {
    bucket                      = "homelab-backup"
    key                         = "tfstate/cloudflare.tfstate"
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

# Reads the token from CLOUDFLARE_API_TOKEN
provider "cloudflare" {}
