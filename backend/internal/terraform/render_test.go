package terraform

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/provisr/backend/internal/manifest"
)

func input(kind string, p map[string]any) *manifest.Manifest {
	return &manifest.Manifest{SchemaVersion: "1.0", Provider: "aws", Region: "us-east-1", Tags: map[string]string{"owner": "platform"}, Resources: []manifest.Resource{{LogicalName: "app", Type: kind, Properties: p}}}
}

func TestCatalogRendersSecureDeterministicFiles(t *testing.T) {
	cases := []struct {
		kind, marker string
		properties   map[string]any
	}{
		{"compute.aws.instance", "http_tokens = \"required\"", map[string]any{"ami": "ami-123", "instance_type": "t3.micro", "subnet_id": "subnet-123"}},
		{"storage.aws.s3", "block_public_policy = true", map[string]any{"bucket": "example-private-bucket"}},
		{"database.aws.rds", "manage_master_user_password = true", map[string]any{"identifier": "app-db", "engine": "mysql", "engine_version": "8.0", "instance_class": "db.t3.micro", "allocated_storage": 20, "master_username": "adminuser", "db_subnet_group_name": "private", "vpc_security_group_ids": []string{"sg-123"}}},
		{"network.aws.vpc", "enable_dns_support = true", map[string]any{"cidr_block": "10.0.0.0/16"}},
		{"network.aws.subnet", "map_public_ip_on_launch = false", map[string]any{"vpc_id": "vpc-123", "cidr_block": "10.0.1.0/24", "availability_zone": "us-east-1a"}},
		{"network.aws.security_group", "ingress = []", map[string]any{"vpc_id": "vpc-123", "description": "Private"}},
	}
	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			m := input(tc.kind, tc.properties)
			before := m.Resources[0].Properties
			a, err := Render(m)
			if err != nil {
				t.Fatal(err)
			}
			b, err := Render(m)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(a, b) || len(a.Files) != 2 || len(a.Unsupported) != 0 {
				t.Fatalf("unexpected render: %+v", a)
			}
			if !strings.Contains(a.Files[1].Content, tc.marker) {
				t.Fatal(a.Files[1].Content)
			}
			if !reflect.DeepEqual(before, m.Resources[0].Properties) {
				t.Fatal("input mutated")
			}
			if binary, err := exec.LookPath("terraform"); err == nil {
				dir := t.TempDir()
				for _, file := range a.Files {
					if err := os.WriteFile(filepath.Join(dir, file.Path), []byte(file.Content), 0600); err != nil {
						t.Fatal(err)
					}
				}
				// fmt parses HCL without downloading providers or contacting AWS.
				if output, err := exec.Command(binary, "fmt", "-write=false", dir).CombinedOutput(); err != nil {
					t.Fatalf("invalid Terraform syntax: %s", output)
				}
			}
		})
	}
}

func TestRejectsInvalidUnsafeAndUnsupportedRequests(t *testing.T) {
	for _, m := range []*manifest.Manifest{
		nil, input("storage.aws.s3", map[string]any{}),
		input("storage.aws.s3", map[string]any{"bucket": "example", "password": "never-render"}),
		input("network.aws.vpc", map[string]any{"cidr_block": "10.0.0.1/16"}),
		input("storage.aws.s3", map[string]any{"bucket": "example", "versioning": "true"}),
	} {
		if out, err := Render(m); err == nil || len(out.Files) != 0 {
			t.Fatalf("invalid input accepted: %+v", out)
		}
	}
	m := input("storage.aws.s3", map[string]any{"bucket": "example"})
	m.Resources[0].SecuritySettings = &manifest.SecuritySettings{PublicAccess: true, EncryptionEnabled: true}
	if _, err := Render(m); err == nil {
		t.Fatal("public storage accepted")
	}
	m = input("compute.aws.nonsense", nil)
	out, err := Render(m)
	if err != nil || len(out.Files) != 0 || len(out.Unsupported) != 1 || out.Unsupported[0].Status != "unsupported" {
		t.Fatalf("unsupported request: %+v %v", out, err)
	}
}

func TestEscapesHCLInterpolationAndOrdersDependencies(t *testing.T) {
	m := input("storage.aws.s3", map[string]any{"bucket": "example"})
	m.Tags = map[string]string{"note": "${file(\"/etc/passwd\")} %{ if true }"}
	m.Resources = append(m.Resources, manifest.Resource{LogicalName: "base", Type: "network.aws.vpc", Properties: map[string]any{"cidr_block": "10.0.0.0/16"}})
	m.Resources[0].DependsOn = []string{"base"}
	out, err := Render(m)
	if err != nil {
		t.Fatal(err)
	}
	text := out.Files[1].Content
	if !strings.Contains(text, "$${file(") || !strings.Contains(text, "%%{ if true }") || !strings.Contains(text, "depends_on = [aws_vpc.r_base]") {
		t.Fatal(text)
	}
	m.Resources[0], m.Resources[1] = m.Resources[1], m.Resources[0]
	again, err := Render(m)
	if err != nil || !reflect.DeepEqual(out, again) {
		t.Fatal("resource ordering changed output")
	}
}

func TestNormalizedInputsAndDistinctSafeIdentifiers(t *testing.T) {
	m := input(" storage.aws.s3 ", map[string]any{"bucket": "example"})
	m.Provider = " AWS "
	m.Region = " us-east-1 "
	m.Resources[0].LogicalName = "providers"
	out, err := Render(m)
	if err != nil {
		t.Fatal(err)
	}
	if out.Files[1].Path == out.Files[0].Path || !strings.Contains(out.Files[1].Content, `"r_providers"`) || !strings.Contains(out.Files[0].Content, `region = "us-east-1"`) {
		t.Fatalf("unsafe identifiers: %+v", out)
	}
	if !reflect.DeepEqual(SupportedDomains(" AWS "), []string{"compute", "database", "network", "storage"}) {
		t.Fatal("inconsistent catalog domains")
	}
	m.Resources[0].LogicalName = "bucket\n"
	if _, err := Render(m); err == nil {
		t.Fatal("padded logical name accepted")
	}
	m = input("network.aws.vpc", map[string]any{"cidr_block": "10.0.0.0/16"})
	m.Resources[0].LogicalName = "123"
	m.Resources[0].SecuritySettings = &manifest.SecuritySettings{EncryptionEnabled: false}
	out, err = Render(m)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.Files[1].Content, `"r_123"`) {
		t.Fatal("numeric logical identifier not safely mapped")
	}
}

func TestRejectsUnsupportedEncryptionMode(t *testing.T) {
	m := input("storage.aws.s3", map[string]any{"bucket": "private-bucket"})
	m.Resources[0].SecuritySettings = &manifest.SecuritySettings{EncryptionEnabled: true, EncryptionType: "aws:kms"}
	out, err := Render(m)
	if err == nil || len(out.Files) != 0 {
		t.Fatal("KMS intent silently rendered as AES256")
	}
}
