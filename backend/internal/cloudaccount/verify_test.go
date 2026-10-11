package cloudaccount

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/rs/zerolog"
)

func TestValidateVerificationPreconditions(t *testing.T) {
	tests := []struct {
		name          string
		provider      string
		currentStatus string
		externalID    string
		wantCode      int
		wantErrType   string
	}{
		{
			name:          "valid pending aws account",
			provider:      "aws",
			currentStatus: "pending",
			externalID:    "ext-12345",
			wantCode:      0,
		},
		{
			name:          "valid failed aws account retry",
			provider:      "aws",
			currentStatus: "failed",
			externalID:    "ext-12345",
			wantCode:      0,
		},
		{
			name:          "non-aws provider azure rejected",
			provider:      "azure",
			currentStatus: "pending",
			externalID:    "ext-12345",
			wantCode:      http.StatusBadRequest,
			wantErrType:   "invalid_provider",
		},
		{
			name:          "non-aws provider gcp rejected",
			provider:      "gcp",
			currentStatus: "pending",
			externalID:    "ext-12345",
			wantCode:      http.StatusBadRequest,
			wantErrType:   "invalid_provider",
		},
		{
			name:          "already active account conflict",
			provider:      "aws",
			currentStatus: "active",
			externalID:    "ext-12345",
			wantCode:      http.StatusConflict,
			wantErrType:   "already_active",
		},
		{
			name:          "disconnected account rejected",
			provider:      "aws",
			currentStatus: "disconnected",
			externalID:    "ext-12345",
			wantCode:      http.StatusBadRequest,
			wantErrType:   "invalid_status",
		},
		{
			name:          "empty external ID rejected",
			provider:      "aws",
			currentStatus: "pending",
			externalID:    "",
			wantCode:      http.StatusBadRequest,
			wantErrType:   "validation_error",
		},
		{
			name:          "whitespace external ID rejected",
			provider:      "aws",
			currentStatus: "pending",
			externalID:    "   ",
			wantCode:      http.StatusBadRequest,
			wantErrType:   "validation_error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, errType, msg := validateVerificationPreconditions(tt.provider, tt.currentStatus, tt.externalID)
			if code != tt.wantCode {
				t.Fatalf("expected code %d, got %d (msg: %s)", tt.wantCode, code, msg)
			}
			if tt.wantErrType != "" && errType != tt.wantErrType {
				t.Fatalf("expected errType %q, got %q", tt.wantErrType, errType)
			}
		})
	}
}

func TestVerifyExternalIDHash(t *testing.T) {
	masterKey := make([]byte, 32)
	for i := range masterKey {
		masterKey[i] = byte(i + 1)
	}
	wsID := uuid.New().String()
	wsKey, err := cloudcrypto.DeriveWorkspaceKey(masterKey, wsID)
	if err != nil {
		t.Fatalf("failed to derive workspace key: %v", err)
	}

	externalID := "provisr-external-id-secret-999"
	hash, err := cloudcrypto.HashExternalID(wsKey, externalID)
	if err != nil {
		t.Fatalf("failed to hash external id: %v", err)
	}

	tests := []struct {
		name        string
		providedID  string
		storedHash  sql.NullString
		expectMatch bool
	}{
		{
			name:        "exact match",
			providedID:  externalID,
			storedHash:  sql.NullString{String: hash, Valid: true},
			expectMatch: true,
		},
		{
			name:        "wrong external id",
			providedID:  "different-external-id",
			storedHash:  sql.NullString{String: hash, Valid: true},
			expectMatch: false,
		},
		{
			name:        "empty provided external id",
			providedID:  "",
			storedHash:  sql.NullString{String: hash, Valid: true},
			expectMatch: false,
		},
		{
			name:        "invalid null stored hash",
			providedID:  externalID,
			storedHash:  sql.NullString{Valid: false},
			expectMatch: false,
		},
		{
			name:        "empty stored hash string",
			providedID:  externalID,
			storedHash:  sql.NullString{String: "", Valid: true},
			expectMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matched := verifyExternalIDHash(wsKey, tt.providedID, tt.storedHash)
			if matched != tt.expectMatch {
				t.Fatalf("expected match=%v, got %v", tt.expectMatch, matched)
			}
		})
	}
}

func TestDefaultAWSVerifier(t *testing.T) {
	verifier := &DefaultAWSVerifier{}
	ctx := context.Background()

	tests := []struct {
		name          string
		roleARN       string
		externalID    string
		wantErr       bool
		wantAccountID string
	}{
		{
			name:          "valid role ARN standard partition",
			roleARN:       "arn:aws:iam::123456789012:role/ProvisrIntegrationRole",
			externalID:    "ext-1234",
			wantErr:       false,
			wantAccountID: "123456789012",
		},
		{
			name:          "valid role ARN with path",
			roleARN:       "arn:aws:iam::987654321098:role/service/provisr/integration-role",
			externalID:    "ext-5678",
			wantErr:       false,
			wantAccountID: "987654321098",
		},
		{
			name:          "valid role ARN us-gov partition",
			roleARN:       "arn:aws-us-gov:iam::112233445566:role/GovCloudRole",
			externalID:    "ext-gov",
			wantErr:       false,
			wantAccountID: "112233445566",
		},
		{
			name:       "invalid ARN prefix",
			roleARN:    "arn:gcp:iam::123456789012:role/SomeRole",
			externalID: "ext-1234",
			wantErr:    true,
		},
		{
			name:       "invalid account ID not 12 digits",
			roleARN:    "arn:aws:iam::12345:role/ShortAccountIDRole",
			externalID: "ext-1234",
			wantErr:    true,
		},
		{
			name:       "empty role ARN",
			roleARN:    "",
			externalID: "ext-1234",
			wantErr:    true,
		},
		{
			name:       "empty external ID",
			roleARN:    "arn:aws:iam::123456789012:role/Role",
			externalID: "",
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := verifier.VerifyRole(ctx, tt.roleARN, tt.externalID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("expected wantErr=%v, got err=%v", tt.wantErr, err)
			}
			if !tt.wantErr {
				if res == nil {
					t.Fatal("expected non-nil result")
				}
				if res.AccountID != tt.wantAccountID {
					t.Fatalf("expected account ID %q, got %q", tt.wantAccountID, res.AccountID)
				}
				if len(res.Regions) == 0 {
					t.Fatal("expected discoverable regions, got none")
				}
			}
		})
	}
}

func TestMockAWSVerifier(t *testing.T) {
	ctx := context.Background()

	// 1. Mock failure (AssumeRole failure simulation)
	mockErr := errors.New("sts:AssumeRole denied: AccessDenied: User is not authorized to perform sts:AssumeRole")
	verifierFail := &MockAWSVerifier{
		VerifyFn: func(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error) {
			return nil, mockErr
		},
	}

	res, err := verifierFail.VerifyRole(ctx, "arn:aws:iam::123456789012:role/DeniedRole", "ext-123")
	if err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("expected AccessDenied error, got res=%v, err=%v", res, err)
	}

	// 2. Mock success
	verifierSuccess := &MockAWSVerifier{
		VerifyFn: func(ctx context.Context, roleARN, externalID string) (*AWSVerificationResult, error) {
			return &AWSVerificationResult{
				AccountID: "123456789012",
				RoleARN:   roleARN,
				Regions:   []string{"us-east-1", "eu-west-1"},
			}, nil
		},
	}

	res, err = verifierSuccess.VerifyRole(ctx, "arn:aws:iam::123456789012:role/ValidRole", "ext-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.AccountID != "123456789012" || len(res.Regions) != 2 {
		t.Fatalf("unexpected mock result: %+v", res)
	}
}

func TestVerifyEndpointHTTPValidation(t *testing.T) {
	masterKey := make([]byte, 32)
	handler := NewWithVerifier(nil, zerolog.Nop(), masterKey, &DefaultAWSVerifier{})

	wsID := uuid.New().String()
	accountID := uuid.New().String()

	tests := []struct {
		name       string
		path       string
		body       string
		wantStatus int
	}{
		{
			name:       "missing workspace ID",
			path:       "/v1/cloud-accounts/" + accountID + "/verify",
			body:       `{"external_id":"ext-123"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid workspace ID UUID",
			path:       "/v1/cloud-accounts/" + accountID + "/verify?workspace_id=invalid-uuid",
			body:       `{"external_id":"ext-123"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid account ID UUID in path",
			path:       "/v1/cloud-accounts/not-a-uuid/verify?workspace_id=" + wsID,
			body:       `{"external_id":"ext-123"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid JSON body",
			path:       "/v1/cloud-accounts/" + accountID + "/verify?workspace_id=" + wsID,
			body:       `not-json`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty external_id in body",
			path:       "/v1/cloud-accounts/" + accountID + "/verify?workspace_id=" + wsID,
			body:       `{"external_id":""}`,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d (body: %s)", tt.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}
