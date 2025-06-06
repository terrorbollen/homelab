``` bash
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644  --token <token> --bind-address 192.168.0.20 

```

``` bash
ansible workers -b -m shell -a "curl -sfL https://get.k3s.io | K3S_URL=https://192.168.0.20:6443 K3S_TOKEN=<token> sh -"

```
