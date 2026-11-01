# Media Server

Hand-rolled chart for the media stack: Emby, Jellyfin, Seerr, Sonarr, Radarr,
Prowlarr, Bazarr and Transmission (over WireGuard). Deployed by Argo CD from
`argocd/apps/media.yaml` as release `media` in namespace `media`.

`values.yaml` only holds images (tracked by Renovate) and resources. Ports,
mounts and paths are fixed in `templates/` because they mirror the on-disk
layout of the `media-ssd` volume (see `templates/storage.yaml`).

All web UIs sit behind `media.192.168.0.36.nip.io/<app>` (Emby on `/`), Seerr
on `jellyseerr.192.168.0.36.nip.io`. Emby and Jellyfin are exposed publicly via
the Cloudflare tunnel (`terraform/cloudflare`), straight to their Services.

`terrafrom/` configures Sonarr, Radarr and Prowlarr through their APIs.
