package manifest

import (
	"strings"
	"testing"
)

func TestValidator_ValidManifest(t *testing.T) {
	v := NewValidator()

	m := &Manifest{
		SchemaVersion:  "1.0.0",
		Provider:       "aws",
		Region:         "us-east-1",
		CloudAccountID: "acc-123456",
		Environment:    "production",
		Resources: []Resource{
			{
				LogicalName: "vpc_network",
				Type:        "network.aws.vpc",
				Properties: map[string]any{
					"cidr_block": "10.0.0.0/16",
				},
				Tags: map[string]string{
					"Environment": "production",
				},
				Source: &SourceMetadata{
					Source:     SourceUserPrompt,
					Confidence: 1.0,
				},
			},
			{
				LogicalName: "app_subnet",
				Type:        "network.aws.subnet",
				DependsOn:   []string{"vpc_network"},
				Properties: map[string]any{
					"cidr_block": "10.0.1.0/24",
				},
				Source: &SourceMetadata{
					Source:     SourceAIAssumption,
					Confidence: 0.85,
				},
			},
			{
				LogicalName: "db_instance",
				Type:        "database.aws.rds_instance",
				DependsOn:   []string{"app_subnet"},
				Properties: map[string]any{
					"engine": "postgres",
				},
				SecuritySettings: &SecuritySettings{
					EncryptionEnabled: true,
					EncryptionType:    "kms",
				},
			},
		},
		CostEstimate: &CostEstimate{
			EstimatedMonthlyUSD: 145.50,
			ConfidencePct:       90,
		},
	}

	result, err := v.Validate(m)
	if err != nil {
		t.Fatalf("unexpected validator error: %v", err)
	}

	if !result.Valid {
		t.Fatalf("expected manifest to be valid, got errors: %+v", result.Errors)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("expected 0 errors, got %d", len(result.Errors))
	}
}

func TestValidator_TopLevelErrors(t *testing.T) {
	v := NewValidator()

	tests := []struct {
		name         string
		manifest     *Manifest
		expectedCode string
	}{
		{
			name:         "nil manifest",
			manifest:     nil,
			expectedCode: "nil_manifest",
		},
		{
			name: "missing schema version",
			manifest: &Manifest{
				Provider:  "aws",
				Region:    "us-east-1",
				Resources: []Resource{{LogicalName: "r1", Type: "storage.aws.s3_bucket"}},
			},
			expectedCode: "missing_schema_version",
		},
		{
			name: "unsupported schema version 2.0",
			manifest: &Manifest{
				SchemaVersion: "2.0.0",
				Provider:      "aws",
				Region:        "us-east-1",
				Resources:     []Resource{{LogicalName: "r1", Type: "storage.aws.s3_bucket"}},
			},
			expectedCode: "unsupported_schema_version",
		},
		{
			name: "missing provider",
			manifest: &Manifest{
				SchemaVersion: "1.0.0",
				Region:        "us-east-1",
				Resources:     []Resource{{LogicalName: "r1", Type: "storage.aws.s3_bucket"}},
			},
			expectedCode: "missing_provider",
		},
		{
			name: "invalid provider digitalocean",
			manifest: &Manifest{
				SchemaVersion: "1.0.0",
				Provider:      "digitalocean",
				Region:        "us-east-1",
				Resources:     []Resource{{LogicalName: "r1", Type: "storage.digitalocean.bucket"}},
			},
			expectedCode: "invalid_provider",
		},
		{
			name: "missing region",
			manifest: &Manifest{
				SchemaVersion: "1.0.0",
				Provider:      "aws",
				Resources:     []Resource{{LogicalName: "r1", Type: "storage.aws.s3_bucket"}},
			},
			expectedCode: "missing_region",
		},
		{
			name: "empty resources array",
			manifest: &Manifest{
				SchemaVersion: "1.0.0",
				Provider:      "aws",
				Region:        "us-east-1",
				Resources:     []Resource{},
			},
			expectedCode: "empty_resources",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := v.Validate(tt.manifest)
			if err != nil {
				t.Fatalf("unexpected execution error: %v", err)
			}
			if res.Valid {
				t.Fatalf("expected validation failure, got valid")
			}
			found := false
			for _, e := range res.Errors {
				if e.Code == tt.expectedCode {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("expected error code %q, got errors: %+v", tt.expectedCode, res.Errors)
			}
		})
	}
}

func TestValidator_ResourceValidationErrors(t *testing.T) {
	v := NewValidator()

	base := func() *Manifest {
		return &Manifest{
			SchemaVersion: "1.0.0",
			Provider:      "aws",
			Region:        "us-east-1",
		}
	}

	tests := []struct {
		name         string
		resources    []Resource
		expectedCode string
	}{
		{
			name: "duplicate logical names",
			resources: []Resource{
				{LogicalName: "my_bucket", Type: "storage.aws.s3_bucket"},
				{LogicalName: "my_bucket", Type: "storage.aws.s3_bucket"},
			},
			expectedCode: "duplicate_logical_name",
		},
		{
			name: "invalid logical name with uppercase and spaces",
			resources: []Resource{
				{LogicalName: "My Invalid Bucket!", Type: "storage.aws.s3_bucket"},
			},
			expectedCode: "invalid_logical_name",
		},
		{
			name: "missing resource type",
			resources: []Resource{
				{LogicalName: "bucket", Type: ""},
			},
			expectedCode: "missing_type",
		},
		{
			name: "invalid type format missing domain",
			resources: []Resource{
				{LogicalName: "bucket", Type: "aws.s3_bucket"},
			},
			expectedCode: "invalid_type_format",
		},
		{
			name: "unrecognized domain in type",
			resources: []Resource{
				{LogicalName: "bucket", Type: "unknown_domain.aws.s3_bucket"},
			},
			expectedCode: "invalid_domain",
		},
		{
			name: "provider mismatch in type (azure type in aws manifest)",
			resources: []Resource{
				{LogicalName: "vm_res", Type: "compute.azure.vm"},
			},
			expectedCode: "provider_mismatch",
		},
		{
			name: "invalid source type",
			resources: []Resource{
				{
					LogicalName: "bucket",
					Type:        "storage.aws.s3_bucket",
					Source: &SourceMetadata{
						Source:     "random_source",
						Confidence: 0.5,
					},
				},
			},
			expectedCode: "invalid_source_type",
		},
		{
			name: "confidence score above 1.0",
			resources: []Resource{
				{
					LogicalName: "bucket",
					Type:        "storage.aws.s3_bucket",
					Source: &SourceMetadata{
						Source:     SourceUserPrompt,
						Confidence: 1.5,
					},
				},
			},
			expectedCode: "invalid_confidence",
		},
		{
			name: "confidence score negative",
			resources: []Resource{
				{
					LogicalName: "bucket",
					Type:        "storage.aws.s3_bucket",
					Source: &SourceMetadata{
						Source:     SourceUserPrompt,
						Confidence: -0.1,
					},
				},
			},
			expectedCode: "invalid_confidence",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := base()
			m.Resources = tt.resources
			res, err := v.Validate(m)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if res.Valid {
				t.Fatalf("expected validation failure, got valid")
			}
			found := false
			for _, e := range res.Errors {
				if e.Code == tt.expectedCode {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("expected error code %q, got %+v", tt.expectedCode, res.Errors)
			}
		})
	}
}

func TestValidator_DependencyErrors(t *testing.T) {
	v := NewValidator()

	// 1. Dangling dependency
	t.Run("dangling dependency", func(t *testing.T) {
		m := &Manifest{
			SchemaVersion: "1.0.0",
			Provider:      "aws",
			Region:        "us-east-1",
			Resources: []Resource{
				{
					LogicalName: "app_server",
					Type:        "compute.aws.ec2_instance",
					DependsOn:   []string{"non_existent_vpc"},
				},
			},
		}

		res, err := v.Validate(m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for dangling dependency")
		}
		if len(res.Errors) == 0 || res.Errors[0].Code != "dangling_dependency" {
			t.Fatalf("expected dangling_dependency code, got %+v", res.Errors)
		}
	})

	// 2. Self dependency
	t.Run("self dependency", func(t *testing.T) {
		m := &Manifest{
			SchemaVersion: "1.0.0",
			Provider:      "aws",
			Region:        "us-east-1",
			Resources: []Resource{
				{
					LogicalName: "loop_node",
					Type:        "storage.aws.s3_bucket",
					DependsOn:   []string{"loop_node"},
				},
			},
		}

		res, err := v.Validate(m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for self dependency")
		}
		found := false
		for _, e := range res.Errors {
			if e.Code == "self_dependency" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected self_dependency error code, got %+v", res.Errors)
		}
	})

	// 3. Circular dependency (2-node loop)
	t.Run("2-node circular dependency", func(t *testing.T) {
		m := &Manifest{
			SchemaVersion: "1.0.0",
			Provider:      "aws",
			Region:        "us-east-1",
			Resources: []Resource{
				{
					LogicalName: "node_a",
					Type:        "network.aws.vpc",
					DependsOn:   []string{"node_b"},
				},
				{
					LogicalName: "node_b",
					Type:        "network.aws.subnet",
					DependsOn:   []string{"node_a"},
				},
			},
		}

		res, err := v.Validate(m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for circular dependency")
		}
		found := false
		for _, e := range res.Errors {
			if e.Code == "circular_dependency" {
				found = true
				if !strings.Contains(e.Message, "node_a") || !strings.Contains(e.Message, "node_b") {
					t.Fatalf("circular dependency message missing cycle nodes: %s", e.Message)
				}
				break
			}
		}
		if !found {
			t.Fatalf("expected circular_dependency error code, got %+v", res.Errors)
		}
	})

	// 4. Circular dependency (3-node loop: A -> B -> C -> A)
	t.Run("3-node circular dependency", func(t *testing.T) {
		m := &Manifest{
			SchemaVersion: "1.0.0",
			Provider:      "aws",
			Region:        "us-east-1",
			Resources: []Resource{
				{
					LogicalName: "res_a",
					Type:        "network.aws.vpc",
					DependsOn:   []string{"res_b"},
				},
				{
					LogicalName: "res_b",
					Type:        "network.aws.subnet",
					DependsOn:   []string{"res_c"},
				},
				{
					LogicalName: "res_c",
					Type:        "compute.aws.ec2_instance",
					DependsOn:   []string{"res_a"},
				},
			},
		}

		res, err := v.Validate(m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for 3-node circular dependency")
		}
		found := false
		for _, e := range res.Errors {
			if e.Code == "circular_dependency" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected circular_dependency error code, got %+v", res.Errors)
		}
	})
}

func TestValidator_CostEstimateErrors(t *testing.T) {
	v := NewValidator()

	base := &Manifest{
		SchemaVersion: "1.0.0",
		Provider:      "aws",
		Region:        "us-east-1",
		Resources: []Resource{
			{LogicalName: "b1", Type: "storage.aws.s3_bucket"},
		},
	}

	t.Run("negative cost estimate", func(t *testing.T) {
		m := *base
		m.CostEstimate = &CostEstimate{EstimatedMonthlyUSD: -50.0, ConfidencePct: 80}
		res, err := v.Validate(&m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for negative cost")
		}
	})

	t.Run("confidence percentage over 100", func(t *testing.T) {
		m := *base
		m.CostEstimate = &CostEstimate{EstimatedMonthlyUSD: 100.0, ConfidencePct: 150}
		res, err := v.Validate(&m)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Valid {
			t.Fatal("expected invalid manifest for confidence pct > 100")
		}
	})
}
