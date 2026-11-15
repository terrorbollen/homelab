terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
    sonarr = {
      source  = "devopsarr/sonarr"
      version = "~> 3.5"
    }
  }
}

provider "kubernetes" {
  config_path = "~/.kube/config"
}
