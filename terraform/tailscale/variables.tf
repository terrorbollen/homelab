# Set in terraform.tfvars (gitignored) to keep the account email out of the
# public repo.

# The only user on the tailnet
variable "owner" {
  type = string
}
