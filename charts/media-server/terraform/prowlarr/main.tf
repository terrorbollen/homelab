data "kubernetes_secret_v1" "prowlarr" {
  metadata {
    name      = "prowlarr-credentials"
    namespace = "media"
  }
}

provider "prowlarr" {
  url     = "http://media.192.168.0.36.nip.io/prowlarr"
  api_key = data.kubernetes_secret_v1.prowlarr.data["api_key"]
}

# Applications sync with these keys; read them from the secrets rather than
# the sonarr/radarr Terraform state so each root stays independent.
data "kubernetes_secret_v1" "radarr" {
  metadata {
    name      = "radarr-credentials"
    namespace = "media"
  }
}

data "kubernetes_secret_v1" "sonarr" {
  metadata {
    name      = "sonarr-credentials"
    namespace = "media"
  }
}
