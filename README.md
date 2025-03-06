# Kubernetes Homelab

![image](docs/images/homelab.jpeg)

A comprehensive Kubernetes homelab setup running on a Raspberry Pi cluster, delivering both public-facing applications and private home services.

## Overview

This repository contains Helm charts for deploying and managing various services in a Kubernetes homelab environment. The setup includes:

1. **Media Server Stack** - A complete media management solution with automated downloading, organizing, and streaming capabilities
2. **Personal Website** - A portfolio website hosted at friis-jespersen.dev
3. **Traefik** - An ingress controller for routing traffic to services
4. **Cert-Manager** - For automated TLS certificate management

## Architecture

The homelab runs on Raspberry Pi nodes with k3s, with services organized into separate namespaces and managed through Helm charts.

### Components

#### Media Server Stack
- **Emby** - Media server for streaming movies and TV shows
- **Sonarr** - TV show management and automation
- **Radarr** - Movie management and automation
- **Bazarr** - Subtitle management
- **Prowlarr** - Indexer management
- **Transmission (with OpenVPN)** - Torrent client with VPN integration

#### Infrastructure
- **Traefik** - Edge router and load balancer
- **Cert-Manager** - Automated TLS certificate management with Let's Encrypt

#### Personal Projects
- **Portfolio Website** - Personal website hosted at friis-jespersen.dev

## Acknowledgments

- [k8s-at-home](https://github.com/k8s-at-home) for many of the Helm charts
- [bananaspliff](https://github.com/bananaspliff) for the geek-charts repository
