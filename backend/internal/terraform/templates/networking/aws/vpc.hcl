resource "aws_vpc" "{{.Name}}" {
  cidr_block = {{hcl .P.cidr_block}}
  enable_dns_support = true
  enable_dns_hostnames = true
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
