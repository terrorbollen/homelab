# Kubernetes Homelab

![image](docs/images/homelab.jpeg)

A Kubernetes homelab delivering both public-facing applications and private home services, deployed via GitOps with ArgoCD.

## Overview

This repository contains Helm charts and ArgoCD Application manifests for the homelab, deployed and managed using ArgoCD.

The setup includes:

1. **Media Server Stack** - Automated downloading, organizing, and streaming of movies/TV
2. **Monitoring & Observability** - Metrics, logs, and dashboards for the cluster
3. **Secrets Management** - Encrypted secrets in git plus a dedicated secrets manager
4. **Networking & Access** - Ingress, TLS, VPN, and tunneled external access
5. **Personal Website** - A portfolio site hosted at friis-jespersen.dev
6. **Other Services** - Self-hosted LLM inference and notes sync

## Architecture

The cluster runs k3s, with services organized into dedicated namespaces and managed through Helm charts.

### Components

#### Media Server Stack
- **Jellyfin** / **Emby** - Media servers for streaming movies and TV shows
- **Sonarr** - TV show management and automation
- **Radarr** - Movie management and automation
- **Bazarr** - Subtitle management
- **Prowlarr** - Indexer management
- **Seerr** - Media request management
- **Transmission** - Torrent client

#### Monitoring & Observability
- **kube-prometheus-stack** - Prometheus, Alertmanager, node-exporter and kube-state-metrics for cluster metrics
- **Telegraf + InfluxDB2** - Host/container metrics collection
- **Promtail + Loki** - Log aggregation
- **Grafana** - Dashboards, fed by both metrics pipelines above plus the community [dotdc/grafana-dashboards-kubernetes](https://github.com/dotdc/grafana-dashboards-kubernetes) set

#### Secrets Management
- **Sealed Secrets** - Encrypts secrets so they're safe to commit to git
- **Infisical** - Secrets manager

#### Networking & Access
- **Traefik** - Ingress controller (k3s's built-in Traefik, with config overrides in `charts/traefik`)
- **Cert-Manager** - Automated TLS certificate management with Let's Encrypt
- **Cloudflare Tunnel** - External access without exposing a public IP
- **Tailscale** - VPN mesh into the homelab

#### Storage
- **local-path-config** - Overrides for k3s's built-in local-path StorageClass (enables volume expansion)

#### Other Services
- **Ollama** - Self-hosted LLM inference
- **Obsidian LiveSync** - CouchDB-backed sync server for Obsidian notes
- **Portfolio Website** - Personal website hosted at friis-jespersen.dev

## GitOps

Services are deployed and kept in sync using ArgoCD. Cert-Manager, Traefik, Cloudflare Tunnel, Ollama, and Descheduler currently exist as charts/config in this repo without a matching ArgoCD Application wired up.

## Acknowledgments

- [k8s-at-home](https://github.com/k8s-at-home) for many of the Helm charts
- [bananaspliff](https://github.com/bananaspliff) for the geek-charts repository
