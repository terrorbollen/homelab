# backup

Nightly CronJob (03:00, on beelink) that copies to the `homelab-backup` R2
bucket under `cluster/<date>/`, keeping 14 days:

- `state.db.gz` and `token`: the k3s database (SQLite) and server token
- `sealed-secrets-keys.yaml`: the keys that decrypt every SealedSecret in git
- `configs.tar.gz`: `/mnt/ssd/media/configs` without logs, cover art and
  Emby's metadata

Terraform state for all roots lives in the same bucket under `tfstate/`.

The bucket holds every cluster Secret in plaintext and is not encrypted;
access is guarded by the Cloudflare account (keep 2FA on).

## Restore

You need only the Cloudflare login. Create an R2 API token for the bucket if
the old keys are gone, then download a dated folder.

**Same node (bad upgrade, corrupt database):**

```sh
systemctl stop k3s
gunzip -c state.db.gz > /var/lib/rancher/k3s/server/db/state.db
rm -f /var/lib/rancher/k3s/server/db/state.db-{wal,shm}
cp token /var/lib/rancher/k3s/server/token
systemctl start k3s
```

**New cluster:** install k3s, then restore the keys before Sealed Secrets
starts so it can decrypt what Argo syncs:

```sh
kubectl apply -f sealed-secrets-keys.yaml
# install Argo CD and apply argocd/apps; restart sealed-secrets if it was running
```

**App configs:** stop the app, then extract its folder from
`configs.tar.gz` into `/mnt/ssd/media/configs`.
