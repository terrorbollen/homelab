resource "tailscale_acl" "policy" {
  acl = <<-EOF
    {
      "tagOwners": {
        "tag:k8s-operator": ["${var.owner}"],
        "tag:k8s":          ["tag:k8s-operator"],
      },

      // Only the owner initiates connections. Tagged cluster devices get no
      // rules, so a compromised pod or proxy can't reach the owner's devices.
      "acls": [
        {
          "action": "accept",
          "src":    ["${var.owner}"],
          "dst": [
            // beelink: Traefik, SSH and the Kubernetes API
            "192.168.0.36:80,443,22,6443",
            // cube01 and cube02
            "192.168.0.32:22",
            "192.168.0.2:22",
          ],
        },
      ],

      // Must match the routes in charts/tailscale/templates/tailscale-connector.yaml
      "autoApprovers": {
        "routes": {
          "192.168.0.36/32": ["tag:k8s"],
          "192.168.0.32/32": ["tag:k8s"],
          "192.168.0.2/32":  ["tag:k8s"],
        },
      },

      "tests": [
        {
          "src": "${var.owner}",
          "accept": [
            "192.168.0.36:80",
            "192.168.0.36:443",
            "192.168.0.36:22",
            "192.168.0.36:6443",
            "192.168.0.32:22",
            "192.168.0.2:22",
          ],
          "deny": [
            // The router admin page must stay unreachable
            "192.168.0.1:80",
            "192.168.0.1:443",
            "10.42.0.1:80",
            "10.43.0.1:443",
            "192.168.0.32:80",
          ],
        },
      ],
    }
  EOF
}

resource "tailscale_tailnet_settings" "settings" {
  devices_approval_on = true
}
