# Off-cluster storage for Terraform state and nightly cluster backups.
resource "cloudflare_r2_bucket" "backups" {
  account_id = var.account_id
  name       = "homelab-backup"
}
