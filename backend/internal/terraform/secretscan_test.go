package terraform

import (
	"testing"

	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/pkg/secretscan"
)

// BE-D06 blocks artifacts with findings, so reviewed templates must scan clean.
func TestReviewedBundlesHaveNoSecretFindings(t *testing.T) {
	m := &manifest.Manifest{SchemaVersion: "1.0", Provider: "aws", Region: "us-east-1", Tags: map[string]string{"owner": "platform"}, Resources: []manifest.Resource{
		{LogicalName: "web", Type: "compute.aws.instance", Properties: map[string]any{"ami": "ami-0abcdef1234567890", "instance_type": "t3.micro", "subnet_id": "subnet-0123456789abcdef0"}},
		{LogicalName: "assets", Type: "storage.aws.s3", Properties: map[string]any{"name": "example-private-bucket"}},
		{LogicalName: "db", Type: "database.aws.rds", Properties: map[string]any{"identifier": "app-db", "engine": "mysql", "engine_version": "8.0", "instance_class": "db.t3.micro", "allocated_storage": 20, "master_username": "adminuser", "db_subnet_group_name": "private", "vpc_security_group_ids": []string{"sg-0123456789abcdef0"}}},
		{LogicalName: "vpc", Type: "network.aws.vpc", Properties: map[string]any{"cidr_block": "10.0.0.0/16"}},
		{LogicalName: "subnet", Type: "network.aws.subnet", Properties: map[string]any{"vpc_id": "vpc-123", "cidr_block": "10.0.1.0/24", "availability_zone": "us-east-1a"}},
		{LogicalName: "sg", Type: "network.aws.security_group", Properties: map[string]any{"vpc_id": "vpc-123", "description": "Private"}},
	}}
	bundle, err := Bundle(m)
	if err != nil || len(bundle.Unsupported) != 0 {
		t.Fatal(err, bundle.Unsupported)
	}
	files := []secretscan.File{}
	for _, f := range bundle.Files {
		files = append(files, secretscan.File{Path: f.Path, Content: f.Content})
	}
	for _, p := range []string{"aws", "azure", "gcp"} {
		config, _ := ProviderConfig(p)
		files = append(files, secretscan.File{Path: p + ".tf", Content: config})
	}
	if findings := secretscan.ScanFiles(files); len(findings) != 0 {
		t.Fatalf("reviewed templates flagged: %+v", findings)
	}
}
