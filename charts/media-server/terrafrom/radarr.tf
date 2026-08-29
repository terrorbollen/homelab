data "kubernetes_secret" "radarr" {
  metadata {
    name      = "radarr-credentials"
    namespace = "media"
  }
}

provider "radarr" {
  url     = "http://media.192.168.0.36.nip.io/radarr"
  api_key = data.kubernetes_secret.radarr.data["api_key"]
}
