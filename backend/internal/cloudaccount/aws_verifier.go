package cloudaccount

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// AWSVerificationResult contains the verified AWS account details.
type AWSVerificationResult struct {
	AccountID string   `json:"account_id"`
	RoleARN   string   `json:"role_arn"`
	Regions   []string `json:"regions"`
}

// AWSVerifier verifies AWS IAM role assumption and access permissions.
type AWSVerifier interface {
	VerifyRole(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error)
}

var (
	// roleARNRegex matches standard AWS IAM Role ARNs:
	// arn:(aws|aws-cn|aws-us-gov):iam::<12-digit-account-id>:role/<role-name-with-path>
	roleARNRegex = regexp.MustCompile(`^arn:aws(?:-[a-z0-9]+)*:iam::(\d{12}):role\/[\w+=,.@\/-]+$`)

	defaultAWSRegions = []string{
		"us-east-1",
		"us-east-2",
		"us-west-1",
		"us-west-2",
		"eu-west-1",
		"eu-central-1",
		"ap-southeast-1",
		"ap-northeast-1",
	}
)

// DefaultAWSVerifier validates role ARN format and external ID, verifying role parameters.
type DefaultAWSVerifier struct{}

// VerifyRole validates the role ARN format and external ID, returning verified account details.
func (v *DefaultAWSVerifier) VerifyRole(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error) {
	roleARN = strings.TrimSpace(roleARN)
	externalID = strings.TrimSpace(externalID)

	if roleARN == "" {
		return nil, errors.New("role_arn must not be empty")
	}
	if externalID == "" {
		return nil, errors.New("external_id must not be empty")
	}

	matches := roleARNRegex.FindStringSubmatch(roleARN)
	if len(matches) < 2 {
		return nil, fmt.Errorf("invalid AWS IAM role ARN format: %q", roleARN)
	}

	accountID := matches[1]

	return &AWSVerificationResult{
		AccountID: accountID,
		RoleARN:   roleARN,
		Regions:   defaultAWSRegions,
	}, nil
}

// MockAWSVerifier allows tests to inject custom verification behavior.
type MockAWSVerifier struct {
	VerifyFn func(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error)
}

func (m *MockAWSVerifier) VerifyRole(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error) {
	if m.VerifyFn != nil {
		return m.VerifyFn(ctx, roleARN, externalID)
	}
	return (&DefaultAWSVerifier{}).VerifyRole(ctx, roleARN, externalID)
}
