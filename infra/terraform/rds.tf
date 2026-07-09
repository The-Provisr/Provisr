# Stub - RDS Postgres instance for Provisr
# TODO: subnet group, security group, aws_db_instance (postgres 16, pgvector
# support via custom parameter group), single database with per-service schemas

resource "aws_db_subnet_group" "main" {
}

resource "aws_security_group" "rds" {
}

resource "aws_db_parameter_group" "postgres16" {
}

resource "aws_db_instance" "main" {
}
