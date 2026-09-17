terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
    radarr = {
      source  = "devopsarr/radarr"
      version = "~> 2.1"
    }
    sonarr = {
      source  = "devopsarr/sonarr"
      version = "~> 3.5"
    }
    prowlarr = {
      source  = "devopsarr/prowlarr"
      version = "~> 3.2"
    }
  }
}

provider "kubernetes" {
  config_path = "~/.kube/config"
}
