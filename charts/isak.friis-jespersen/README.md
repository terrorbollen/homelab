# Isak Friis-Jespersen Helm Chart

This Helm chart deploys Isak Friis-Jespersen's personal website.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- Traefik Ingress Controller
- Cert-Manager for TLS certificates

## Installing the Chart

```bash
helm install ifj ./isak-friis-jespersen
```

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `3` |
| `image.repository` | Image repository | `gigday/ifj` |
| `image.tag` | Image tag | `latest` |
| `service.type` | Service type | `LoadBalancer` |
| `service.port` | Service port | `8081` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.hosts[0].host` | Hostname | `friis-jespersen.dev` |
