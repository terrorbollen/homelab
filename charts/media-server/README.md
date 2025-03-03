# Mediaserver Helm Chart

This Helm chart deploys a complete media server stack including:

- Bazarr (using k8s-at-home chart)
- Emby (using k8s-at-home chart)
- Prowlarr (using k8s-at-home chart)
- Radarr (using k8s-at-home chart)
- Sonarr (using k8s-at-home chart)
- Transmission (using k8s-at-home chart)

## Dependencies

This chart relies on the following dependencies from k8s-at-home:

- [k8s-at-home/bazarr](https://github.com/k8s-at-home/charts/tree/master/charts/stable/bazarr)
- [k8s-at-home/emby](https://github.com/k8s-at-home/charts/tree/master/charts/stable/emby)
- [k8s-at-home/prowlarr](https://github.com/k8s-at-home/charts/tree/master/charts/stable/prowlarr)
- [k8s-at-home/radarr](https://github.com/k8s-at-home/charts/tree/master/charts/stable/radarr)
- [k8s-at-home/sonarr](https://github.com/k8s-at-home/charts/tree/master/charts/stable/sonarr)
- [k8s-at-home/transmission-openvpn](https://github.com/k8s-at-home/charts/tree/master/charts/stable/transmission-openvpn)
- [k8s-at-home/common](https://github.com/k8s-at-home/library-charts/tree/main/charts/stable/common)

## Installation

```bash
# Update dependencies
helm dependency update

# Install the chart
helm install mediaserver . -n media --create-namespace
```

## Configuration

See the `values.yaml` file for configuration options. You can customize each application by overriding its values.

### Storage

The chart creates:
- A StorageClass named `manual`
- A PersistentVolume that points to `/mnt/ssd/media` on the host
- A PersistentVolumeClaim that applications can use

### Ingress

An Ingress resource is created to expose the applications with the following paths:
- `/transmission` - Transmission WebUI
- `/sonarr` - Sonarr WebUI
- `/radarr` - Radarr WebUI
- `/prowlarr` - Prowlarr WebUI
- `/` - Emby WebUI

By default, the ingress uses nip.io with your configured IP address.
