# Media Server Helm Chart

This Helm chart deploys a complete media server stack including Bazarr, Emby, Prowlarr, Radarr, Sonarr, and Transmission.

## Handling Existing PV and PVC

If you already have existing PersistentVolume and PersistentVolumeClaim resources that you want to use with this chart, you have two options:

### Option 1: Adopt Existing Resources (Recommended)

This option adds Helm ownership labels to your existing resources so Helm can manage them:

1. Set the following in your values.yaml:
   ```yaml
   storage:
     persistentVolume:
       create: false
       adopt: true
     persistentVolumeClaim:
       create: false
       adopt: true
   ```

2. Run the provided adoption script to add Helm labels to your existing resources:
   ```bash
   ./adopt-storage.sh
   ```

3. Install or upgrade your Helm chart:
   ```bash
   helm upgrade --install media ./charts/media-server -n media
   ```

### Option 2: Use Existing Resources Without Helm Management

If you prefer to keep your storage resources managed outside of Helm:

1. Set the following in your values.yaml:
   ```yaml
   storage:
     persistentVolume:
       create: false
       adopt: false
     persistentVolumeClaim:
       create: false
       adopt: false
   ```

2. Install or upgrade your Helm chart:
   ```bash
   helm upgrade --install media ./charts/media-server -n media
   ```

3. Manually ensure your applications use the correct PVC by setting the appropriate values for each application.

## Configuration

See the values.yaml file for configuration options.

## Dependencies

This chart uses the following dependencies:
- Bazarr, Emby, Prowlarr, Radarr, Sonarr: from k8s-at-home charts repository
- Transmission-OpenVPN: from bananaspliff/geek-charts repository
