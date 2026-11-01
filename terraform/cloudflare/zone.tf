data "cloudflare_zone" "main" {
  filter = {
    name = var.zone_name
  }
}

locals {
  zone_id = data.cloudflare_zone.main.zone_id
}

# TLS hardening
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = local.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = local.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls_1_3" {
  zone_id    = local.zone_id
  setting_id = "tls_1_3"
  value      = "on"
}

resource "cloudflare_zone_setting" "security_level" {
  zone_id    = local.zone_id
  setting_id = "security_level"
  value      = "medium"
}

resource "cloudflare_zone_setting" "browser_check" {
  zone_id    = local.zone_id
  setting_id = "browser_check"
  value      = "on"
}

# Bot Fight Mode stays off: it applies zone-wide and can't be skipped for
# Jellyfin, whose TV apps would get challenged.
resource "cloudflare_bot_management" "main" {
  zone_id            = local.zone_id
  fight_mode         = false
  ai_bots_protection = "block"
}

# Needs the DS record (see the dnssec_ds output) added at the registrar
# unless the domain is registered with Cloudflare.
resource "cloudflare_zone_dnssec" "main" {
  zone_id = local.zone_id
  status  = "active"
}

# The domain sends no mail, so tell receivers to reject anything claiming it.
resource "cloudflare_dns_record" "spf" {
  zone_id = local.zone_id
  name    = var.zone_name
  type    = "TXT"
  content = "\"v=spf1 -all\""
  ttl     = 1
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.zone_name}"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s\""
  ttl     = 1
}

output "dnssec_ds" {
  value = cloudflare_zone_dnssec.main.ds
}
