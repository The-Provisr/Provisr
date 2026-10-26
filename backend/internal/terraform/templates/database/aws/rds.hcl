resource "aws_db_instance" "{{.Name}}" {
  identifier = {{hcl .P.identifier}}
  engine = {{hcl .P.engine}}
  engine_version = {{hcl .P.engine_version}}
  instance_class = {{hcl .P.instance_class}}
  allocated_storage = {{hcl .P.allocated_storage}}
  username = {{hcl .P.master_username}}
  manage_master_user_password = true
  storage_encrypted = true
  publicly_accessible = false
  deletion_protection = true
  backup_retention_period = 7
  skip_final_snapshot = false
  final_snapshot_identifier = {{hcl .P.identifier}} # override through a reviewed manifest when destroying
  db_subnet_group_name = {{hcl .P.db_subnet_group_name}}
  vpc_security_group_ids = {{hcl .P.vpc_security_group_ids}}
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
