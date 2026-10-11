# Stub - ECR repositories for Provisr service images
# TODO: one repository per service (orchestration, policy, approval, state,
# reconciler, audit, notification, provisioning, workspace, cloud_account)
# plus agent services

resource "aws_ecr_repository" "orchestration" {
}

resource "aws_ecr_repository" "policy" {
}

resource "aws_ecr_repository" "approval" {
}

resource "aws_ecr_repository" "state" {
}

resource "aws_ecr_repository" "reconciler" {
}

resource "aws_ecr_repository" "audit" {
}

resource "aws_ecr_repository" "notification" {
}

resource "aws_ecr_repository" "provisioning" {
}

resource "aws_ecr_repository" "workspace" {
}

resource "aws_ecr_repository" "cloud_account" {
}
