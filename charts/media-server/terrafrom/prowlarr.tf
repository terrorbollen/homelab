data "kubernetes_secret" "prowlarr" {
  metadata {
    name      = "prowlarr-credentials"
    namespace = "media"
  }
}

provider "prowlarr" {
  url     = "http://media.192.168.0.36.nip.io/prowlarr"
  api_key = data.kubernetes_secret.prowlarr.data["api_key"]
}
