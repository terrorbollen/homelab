# Jellyfin and Emby are only reachable from the allowed home IPs. Their TV
# apps can't get through a login page, so this is done by IP instead.
locals {
  media_hosts = format("{%s}", join(" ", [for h in [var.jellyfin_hostname, var.emby_hostname] : "\"${h}\""]))
}

resource "cloudflare_list" "media_allowed" {
  account_id  = var.account_id
  name        = "media_allowed"
  kind        = "ip"
  description = "Home IPs allowed to reach Jellyfin and Emby"
  items       = var.media_allowed_ips
}

# Free plan: one ruleset per phase, 5 custom rules
resource "cloudflare_ruleset" "waf_custom" {
  zone_id = local.zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  rules = [
    {
      description = "Media: only allowed home IPs"
      expression  = format("(http.host in %s and not ip.src in $%s)", local.media_hosts, cloudflare_list.media_allowed.name)
      action      = "block"
    },
  ]
}

# Free plan: one rule, 10s period and 10s timeout, counted per IP and colo.
# Both apps log in through /Users/AuthenticateByName.
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = local.zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      description = "Media: throttle login attempts"
      expression  = format("(http.host in %s and http.request.uri.path contains \"/Users/AuthenticateByName\")", local.media_hosts)
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = 5
        mitigation_timeout  = 10
      }
    },
  ]
}

# TV apps aren't browsers and can fail Browser Integrity Check
resource "cloudflare_ruleset" "config" {
  zone_id = local.zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_config_settings"

  rules = [
    {
      description = "Media: skip Browser Integrity Check"
      expression  = format("(http.host in %s)", local.media_hosts)
      action      = "set_config"
      action_parameters = {
        bic = false
      }
    },
  ]
}
