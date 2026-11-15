data "kubernetes_secret" "sonarr" {
  metadata {
    name      = "sonarr-credentials"
    namespace = "media"
  }
}

provider "sonarr" {
  url     = "http://media.192.168.0.36.nip.io/sonarr"
  api_key = data.kubernetes_secret.sonarr.data["api_key"]
}
