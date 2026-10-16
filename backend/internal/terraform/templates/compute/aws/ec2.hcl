resource "aws_instance" "{{.Name}}" {
  ami = {{hcl .P.ami}}
  instance_type = {{hcl .P.instance_type}}
  subnet_id = {{hcl .P.subnet_id}}
  associate_public_ip_address = false
  metadata_options { http_tokens = "required" }
  root_block_device { encrypted = true }
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
