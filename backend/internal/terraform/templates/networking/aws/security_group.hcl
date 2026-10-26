resource "aws_security_group" "{{.Name}}" {
  vpc_id = {{hcl .P.vpc_id}}
  description = {{hcl .P.description}}
  ingress = []
  egress = []
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
