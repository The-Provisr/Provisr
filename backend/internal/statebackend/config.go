// Package statebackend prepares the provisioner-controlled remote Terraform
// state backend per connected cloud account. It never reads or serves state.
package statebackend

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// Settings holds non-secret backend resource names only; never credentials.
type Settings struct {
	Bucket         string `json:"bucket,omitempty"`
	Region         string `json:"region,omitempty"`
	LockTable      string `json:"dynamodb_table,omitempty"`
	ResourceGroup  string `json:"resource_group,omitempty"`
	StorageAccount string `json:"storage_account,omitempty"`
	Container      string `json:"container,omitempty"`
}

const (
	azureResourceGroup = "provisr-tfstate"
	azureContainer     = "tfstate"
)

var (
	awsAccountPattern = regexp.MustCompile(`^[0-9]{12}$`)
	regionPattern     = regexp.MustCompile(`^[a-z]{2}(?:-[a-z]+)+-[0-9]+$`)
	namePattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
)

// suffix binds names to both the workspace and the cloud identity, so two
// workspaces sharing an account never share a bucket or lock table.
func suffix(workspaceID, identity string, n int) string {
	sum := sha256.Sum256([]byte("provisr-tfstate|" + workspaceID + "|" + identity))
	return hex.EncodeToString(sum[:])[:n]
}

// AWSSettings derives the S3 bucket and DynamoDB lock table for an account.
func AWSSettings(workspaceID, accountID, region string) (Settings, error) {
	if !awsAccountPattern.MatchString(accountID) || !regionPattern.MatchString(region) {
		return Settings{}, fmt.Errorf("invalid AWS backend identity")
	}
	s := suffix(workspaceID, accountID, 12)
	return Settings{Bucket: "provisr-tfstate-" + accountID + "-" + s, Region: region, LockTable: "provisr-tf-locks-" + s}, nil
}

// AzureSettings derives a storage account name: 3-24 lowercase alphanumerics.
func AzureSettings(workspaceID, cloudAccountID string) Settings {
	return Settings{ResourceGroup: azureResourceGroup, StorageAccount: "ptfs" + suffix(workspaceID, cloudAccountID, 20), Container: azureContainer}
}

// GCPSettings derives a GCS bucket name (GCS provides native object locking).
func GCPSettings(workspaceID, cloudAccountID string) Settings {
	return Settings{Bucket: "provisr-tfstate-" + suffix(workspaceID, cloudAccountID, 20)}
}

// statePrefix scopes state per run so a run only manages its own resources.
func statePrefix(workspaceID, runID string) (string, error) {
	ws, err := uuid.Parse(workspaceID)
	if err != nil || ws == uuid.Nil {
		return "", fmt.Errorf("invalid workspace ID")
	}
	run, err := uuid.Parse(runID)
	if err != nil || run == uuid.Nil {
		return "", fmt.Errorf("invalid run ID")
	}
	return "workspaces/" + ws.String() + "/runs/" + run.String(), nil
}

// InitConfig returns credential-free `terraform init -backend-config` values
// matching the partial backend blocks emitted by terraform.ProviderConfig.
func InitConfig(provider string, s Settings, workspaceID, runID string) (map[string]string, error) {
	prefix, err := statePrefix(workspaceID, runID)
	if err != nil {
		return nil, err
	}
	switch provider {
	case "aws":
		if !namePattern.MatchString(s.Bucket) || !regionPattern.MatchString(s.Region) || !namePattern.MatchString(s.LockTable) {
			return nil, fmt.Errorf("incomplete AWS backend settings")
		}
		return map[string]string{"bucket": s.Bucket, "key": prefix + "/terraform.tfstate", "region": s.Region,
			"dynamodb_table": s.LockTable, "encrypt": "true"}, nil
	case "azure":
		if s.ResourceGroup == "" || s.StorageAccount == "" || s.Container == "" {
			return nil, fmt.Errorf("incomplete Azure backend settings")
		}
		return map[string]string{"resource_group_name": s.ResourceGroup, "storage_account_name": s.StorageAccount,
			"container_name": s.Container, "key": prefix + "/terraform.tfstate", "use_azuread_auth": "true"}, nil
	case "gcp":
		if !namePattern.MatchString(s.Bucket) {
			return nil, fmt.Errorf("incomplete GCP backend settings")
		}
		return map[string]string{"bucket": s.Bucket, "prefix": prefix}, nil
	default:
		return nil, fmt.Errorf("unsupported provider")
	}
}

// HCL renders init values as a deterministic backend config file.
func HCL(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, key := range keys {
		value := values[key]
		if value != "true" && value != "false" {
			value = strconv.Quote(value)
		}
		fmt.Fprintf(&b, "%s = %s\n", key, value)
	}
	return b.String()
}
