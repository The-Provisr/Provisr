resource "aws_s3_bucket" "{{.Name}}" {
  bucket = {{hcl .P.bucket}}
  tags = {{hcl .Tags}}
  depends_on = [{{.Dependencies}}]
}
resource "aws_s3_bucket_public_access_block" "{{.Name}}" {
  bucket = aws_s3_bucket.{{.Name}}.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "{{.Name}}" {
  bucket = aws_s3_bucket.{{.Name}}.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "{{.Name}}" {
  bucket = aws_s3_bucket.{{.Name}}.id
  versioning_configuration { status = "{{if .P.versioning}}Enabled{{else}}Suspended{{end}}" }
}
