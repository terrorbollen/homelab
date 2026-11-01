# All values are set in terraform.tfvars (gitignored) to keep account details
# and hostnames out of the public repo. See terraform.tfvars.example.

variable "account_id" {
  type = string
}

variable "zone_name" {
  type = string
}

# Remote-managed tunnel run by charts/cloudflare-tunnel
variable "tunnel_id" {
  type = string
}

variable "jellyfin_hostname" {
  type = string
}

variable "emby_hostname" {
  type = string
}

# Home IPs allowed to reach Jellyfin and Emby.
# IPv6 entries must be prefixes between /12 and /64.
variable "media_allowed_ips" {
  type = list(object({
    ip      = string
    comment = string
  }))
}
