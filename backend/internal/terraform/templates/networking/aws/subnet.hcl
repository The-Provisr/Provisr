resource "aws_subnet" "{{.Name}}" {
  vpc_id = {{hcl .P.vpc_id}}
  cidr_block = {{hcl .P.cidr_block}}
  availability_zone = {{hcl .P.availability_zone}}
  map_public_ip_on_launch = false
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
