# =============================================================================
# Prowlarr Applications - sync targets extracted live from the running instance
# =============================================================================

resource "prowlarr_application_radarr" "radarr" {
  name            = "Radarr"
  sync_level      = "fullSync"
  prowlarr_url    = "http://media.192.168.0.36.nip.io/prowlarr"
  base_url        = "http://media.192.168.0.36.nip.io/radarr"
  api_key         = data.kubernetes_secret.radarr.data["api_key"]
  sync_categories = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090]
  tags            = []
}

resource "prowlarr_application_sonarr" "sonarr" {
  name                  = "Sonarr"
  sync_level            = "fullSync"
  prowlarr_url          = "http://media.192.168.0.36.nip.io/prowlarr"
  base_url              = "http://media.192.168.0.36.nip.io/sonarr"
  api_key               = data.kubernetes_secret.sonarr.data["api_key"]
  sync_categories       = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090]
  anime_sync_categories = [5070]
  tags                  = []
}