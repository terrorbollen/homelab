# Cloudflare holds a single ingress config for the whole tunnel, so every
# route has to be declared here; the existing one is imported first.
import {
  to = cloudflare_zero_trust_tunnel_cloudflared_config.homelab
  id = "${var.account_id}/${var.tunnel_id}"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "homelab" {
  account_id = var.account_id
  tunnel_id  = var.tunnel_id

  config = {
    ingress = [
      # Existing routes, matching the live tunnel config
      {
        hostname = var.zone_name
        service  = "http://portfolio-isak-friis-jespersen.isakfriis-jespersen.svc:8081"
      },
      {
        hostname = var.emby_hostname
        service  = "http://media-emby.media.svc:80"
      },
      {
        hostname = var.jellyfin_hostname
        service  = "http://media-jellyfin.media.svc:80"
      },
      {
        service = "http_status:404"
      },
    ]
  }
}

resource "cloudflare_dns_record" "jellyfin" {
  zone_id = local.zone_id
  name    = var.jellyfin_hostname
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
