package statebackend

import (
	"regexp"
	"strings"
	"testing"
)

const (
	workspace = "11111111-1111-4111-8111-111111111111"
	otherWS   = "22222222-2222-4222-8222-222222222222"
	run       = "33333333-3333-4333-8333-333333333333"
	accountID = "123456789012"
)

func TestNamesAreDeterministicScopedAndValid(t *testing.T) {
	a, err := AWSSettings(workspace, accountID, "eu-west-1")
	if err != nil {
		t.Fatal(err)
	}
	again, _ := AWSSettings(workspace, accountID, "eu-west-1")
	other, _ := AWSSettings(otherWS, accountID, "eu-west-1")
	if a != again || a.Bucket == other.Bucket || a.LockTable == other.LockTable {
		t.Fatalf("names must be stable per workspace and distinct across workspaces: %+v %+v", a, other)
	}
	if !regexp.MustCompile(`^provisr-tfstate-123456789012-[0-9a-f]{12}$`).MatchString(a.Bucket) || len(a.Bucket) > 63 {
		t.Fatalf("invalid S3 bucket name %q", a.Bucket)
	}
	if !regexp.MustCompile(`^provisr-tf-locks-[0-9a-f]{12}$`).MatchString(a.LockTable) {
		t.Fatalf("invalid lock table name %q", a.LockTable)
	}
	az := AzureSettings(workspace, run)
	if !regexp.MustCompile(`^[a-z0-9]{3,24}$`).MatchString(az.StorageAccount) || az.StorageAccount == AzureSettings(otherWS, run).StorageAccount {
		t.Fatalf("invalid Azure storage account %q", az.StorageAccount)
	}
	gcs := GCPSettings(workspace, run)
	if !namePattern.MatchString(gcs.Bucket) || gcs.Bucket == GCPSettings(otherWS, run).Bucket {
		t.Fatalf("invalid GCS bucket %q", gcs.Bucket)
	}
	for _, bad := range [][2]string{{"12345", "us-east-1"}, {accountID, "US-EAST-1"}, {accountID, "us-east-1\"x"}} {
		if _, err := AWSSettings(workspace, bad[0], bad[1]); err == nil {
			t.Fatalf("accepted invalid identity %v", bad)
		}
	}
}

func TestInitConfigPerProviderIsRunScopedAndCredentialFree(t *testing.T) {
	a, _ := AWSSettings(workspace, accountID, "us-east-1")
	key := "workspaces/" + workspace + "/runs/" + run
	for _, tc := range []struct {
		provider string
		settings Settings
		want     map[string]string
	}{
		{"aws", a, map[string]string{"bucket": a.Bucket, "key": key + "/terraform.tfstate", "region": "us-east-1", "dynamodb_table": a.LockTable, "encrypt": "true"}},
		{"azure", AzureSettings(workspace, run), map[string]string{"resource_group_name": "provisr-tfstate", "storage_account_name": AzureSettings(workspace, run).StorageAccount,
			"container_name": "tfstate", "key": key + "/terraform.tfstate", "use_azuread_auth": "true"}},
		{"gcp", GCPSettings(workspace, run), map[string]string{"bucket": GCPSettings(workspace, run).Bucket, "prefix": key}},
	} {
		got, err := InitConfig(tc.provider, tc.settings, workspace, run)
		if err != nil {
			t.Fatalf("%s: %v", tc.provider, err)
		}
		if len(got) != len(tc.want) {
			t.Fatalf("%s: got %v", tc.provider, got)
		}
		for k, v := range tc.want {
			if got[k] != v {
				t.Fatalf("%s: %s = %q, want %q", tc.provider, k, got[k], v)
			}
		}
		rendered := strings.ToLower(HCL(got))
		for _, secret := range []string{"access_key", "secret", "token", "sas", "credentials", "client_secret"} {
			if strings.Contains(rendered, secret) {
				t.Fatalf("%s backend config contains %q", tc.provider, secret)
			}
		}
	}
	if _, err := InitConfig("aws", a, workspace, "../../other"); err == nil {
		t.Fatal("accepted path traversal run ID")
	}
	if _, err := InitConfig("aws", Settings{}, workspace, run); err == nil {
		t.Fatal("accepted incomplete settings")
	}
	if _, err := InitConfig("oci", a, workspace, run); err == nil {
		t.Fatal("accepted unsupported provider")
	}
}

func TestHCLIsSortedAndQuoted(t *testing.T) {
	got := HCL(map[string]string{"region": "us-east-1", "encrypt": "true", "bucket": "b"})
	if got != "bucket = \"b\"\nencrypt = true\nregion = \"us-east-1\"\n" {
		t.Fatalf("unexpected HCL:\n%s", got)
	}
}
