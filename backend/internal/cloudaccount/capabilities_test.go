package cloudaccount

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
)

const capabilityWorkspace = "05a0cb9b-6793-4d47-ac80-c37916dc7b57"

type memoryCapabilityStore struct {
	accounts []CapabilityAccount
	calls    int
}

func (s *memoryCapabilityStore) Accounts(_ context.Context, _ string) ([]CapabilityAccount, error) {
	s.calls++
	return s.accounts, nil
}

type fakeDiscovery struct {
	calls int
	fail  bool
}

func (p *fakeDiscovery) Discover(_ context.Context, _ CapabilityAccount) (Discovery, error) {
	p.calls++
	if p.fail {
		return Discovery{}, errors.New("SECRET provider response")
	}
	return Discovery{AccountID: "123456789012", Regions: []string{"us-west-2", "us-east-1"}, PermissionsVerified: true}, nil
}
func account() CapabilityAccount {
	return CapabilityAccount{ID: capabilityWorkspace, WorkspaceID: capabilityWorkspace, Provider: "aws", Label: "Development", Status: "active", VerifiedAt: time.Now(), UpdatedAt: time.Now(), DefaultRegion: "us-west-2", RoleARN: "SECRET", ExternalID: "SECRET"}
}
func callCapabilities(handler http.Handler, token, workspace string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	mux.Handle("GET /v1/workspaces/{workspace_id}/cloud-capabilities", handler)
	r := httptest.NewRequest("GET", "/v1/workspaces/"+workspace+"/cloud-capabilities", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}
func TestCapabilitiesCacheScopeMaskingAndInvalidation(t *testing.T) {
	s := &memoryCapabilityStore{accounts: []CapabilityAccount{account()}}
	p := &fakeDiscovery{}
	h := NewCapabilitiesHandler(s, p, "test-service-token").(*capabilitiesHandler)
	var out Capabilities
	for i := 0; i < 2; i++ {
		w := callCapabilities(h, "test-service-token", capabilityWorkspace)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		if strings.Contains(w.Body.String(), "SECRET") || strings.Contains(w.Body.String(), "123456789012") {
			t.Fatal("unsafe identity exposed")
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	if p.calls != 1 || s.calls != 2 || !out.Accounts[0].ExecutionReady || out.Accounts[0].AccountIdentity != "********9012" || len(out.Accounts[0].SupportedDomains) != 4 {
		t.Fatalf("bad capabilities: %+v", out)
	}
	s.accounts[0].UpdatedAt = s.accounts[0].UpdatedAt.Add(time.Second)
	callCapabilities(h, "test-service-token", capabilityWorkspace)
	if p.calls != 2 {
		t.Fatal("metadata mutation failed to invalidate discovery")
	}
	s.accounts[0].Status = "disconnected"
	w := callCapabilities(h, "test-service-token", capabilityWorkspace)
	if strings.Contains(w.Body.String(), `"execution_ready":true`) {
		t.Fatal("stale readiness after disconnect")
	}
	s.accounts[0].Status = "active"
	h.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	callCapabilities(h, "test-service-token", capabilityWorkspace)
	if p.calls != 3 {
		t.Fatal("expired cache used")
	}
}
func TestCapabilitiesFailClosedAndEmptyState(t *testing.T) {
	s := &memoryCapabilityStore{}
	p := &fakeDiscovery{fail: true}
	h := NewCapabilitiesHandler(s, p, "token")
	if callCapabilities(h, "wrong", capabilityWorkspace).Code != 401 || s.calls != 0 {
		t.Fatal("unauthorized discovery")
	}
	if callCapabilities(h, "token", "invalid").Code != 400 {
		t.Fatal("invalid workspace")
	}
	w := callCapabilities(h, "token", capabilityWorkspace)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"accounts":[]`) {
		t.Fatal(w.Body.String())
	}
	s.accounts = []CapabilityAccount{account()}
	w = callCapabilities(h, "token", capabilityWorkspace)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "provider_discovery_unavailable") || strings.Contains(w.Body.String(), "SECRET") {
		t.Fatal(w.Body.String())
	}
	s.accounts[0].WorkspaceID = "foreign"
	if callCapabilities(h, "token", capabilityWorkspace).Code != 502 {
		t.Fatal("foreign workspace accepted")
	}
	s.accounts[0] = account()
	s.accounts[0].Provider = "azure"
	w = callCapabilities(h, "token", capabilityWorkspace)
	if !strings.Contains(w.Body.String(), "provider_discovery_not_supported") {
		t.Fatal(w.Body.String())
	}
}

type discoveryHTTP func(*http.Request) (*http.Response, error)

func (f discoveryHTTP) Do(r *http.Request) (*http.Response, error) { return f(r) }
func TestAWSDiscoveryUsesDelegatedCredentialsAndFiltersRegions(t *testing.T) {
	calls := []string{}
	decision := "allowed"
	client := discoveryHTTP(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		action, _ := io.ReadAll(strings.NewReader(string(body)))
		var response string
		switch {
		case strings.Contains(string(action), "Action=AssumeRole"):
			calls = append(calls, "sts")
			if !strings.Contains(string(action), "ExternalId=external-test") {
				t.Fatal("missing external ID")
			}
			response = `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials><AccessKeyId>delegated-key</AccessKeyId><SecretAccessKey>delegated-secret</SecretAccessKey><SessionToken>delegated-token</SessionToken><Expiration>` + time.Now().Add(time.Hour).UTC().Format(time.RFC3339) + `</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`
		case strings.Contains(string(action), "Action=DescribeRegions"):
			calls = append(calls, "ec2")
			if !strings.Contains(r.Header.Get("Authorization"), "delegated-key") {
				t.Fatal("used platform credentials for account discovery")
			}
			response = `<DescribeRegionsResponse><regionInfo><item><regionName>us-east-1</regionName><optInStatus>opt-in-not-required</optInStatus></item><item><regionName>af-south-1</regionName><optInStatus>not-opted-in</optInStatus></item></regionInfo></DescribeRegionsResponse>`
		case strings.Contains(string(action), "Action=SimulatePrincipalPolicy"):
			calls = append(calls, "iam")
			response = `<SimulatePrincipalPolicyResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><SimulatePrincipalPolicyResult><IsTruncated>false</IsTruncated><EvaluationResults>`
			for _, a := range readinessActions {
				response += `<member><EvalActionName>` + a + `</EvalActionName><EvalDecision>` + decision + `</EvalDecision></member>`
			}
			response += `</EvaluationResults></SimulatePrincipalPolicyResult></SimulatePrincipalPolicyResponse>`
		default:
			t.Fatalf("unexpected provider operation: %s", r.URL.Host)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(response))}, nil
	})
	d := AWSDiscovery{LoadConfig: func(_ context.Context, region string) (aws.Config, error) {
		return aws.Config{Region: region, HTTPClient: client, Credentials: credentials.NewStaticCredentialsProvider("platform-key", "platform-secret", ""), RetryMaxAttempts: 1}, nil
	}}
	a := account()
	a.RoleARN = "arn:aws:iam::123456789012:role/ProvisrExecutionRole"
	a.ExternalID = "external-test"
	facts, err := d.Discover(context.Background(), a)
	if err != nil || !facts.PermissionsVerified || len(facts.Regions) != 1 || strings.Join(calls, ",") != "sts,ec2,iam" {
		t.Fatalf("discovery failed: %+v %v calls=%v", facts, err, calls)
	}
	decision = "explicitDeny"
	facts, err = d.Discover(context.Background(), a)
	if err != nil || facts.PermissionsVerified {
		t.Fatal("denied permissions reported as execution ready")
	}
}

func TestProactiveRefreshDropsPreviousReadinessOnFailure(t *testing.T) {
	s := &memoryCapabilityStore{accounts: []CapabilityAccount{account()}}
	p := &fakeDiscovery{}
	h := NewCapabilitiesHandler(s, p, "token").(*capabilitiesHandler)
	callCapabilities(h, "token", capabilityWorkspace)
	p.fail = true
	h.Refresh(context.Background(), capabilityWorkspace)
	w := callCapabilities(h, "token", capabilityWorkspace)
	if strings.Contains(w.Body.String(), `"execution_ready":true`) {
		t.Fatal("refresh failure retained readiness")
	}
}

type discoveryFunc func(context.Context, CapabilityAccount) (Discovery, error)

func (f discoveryFunc) Discover(ctx context.Context, a CapabilityAccount) (Discovery, error) {
	return f(ctx, a)
}
func TestRefreshInvalidatesInFlightDiscovery(t *testing.T) {
	s := &memoryCapabilityStore{accounts: []CapabilityAccount{account()}}
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	var calls atomic.Int32
	p := discoveryFunc(func(context.Context, CapabilityAccount) (Discovery, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return Discovery{AccountID: "123456789012", Regions: []string{"us-east-1"}, PermissionsVerified: true}, nil
		}
		return Discovery{}, errors.New("revoked")
	})
	h := NewCapabilitiesHandler(s, p, "token").(*capabilitiesHandler)
	go func() { defer close(done); callCapabilities(h, "token", capabilityWorkspace) }()
	<-started
	h.Refresh(context.Background(), capabilityWorkspace)
	close(release)
	<-done
	w := callCapabilities(h, "token", capabilityWorkspace)
	if strings.Contains(w.Body.String(), `"execution_ready":true`) {
		t.Fatal("stale in-flight discovery restored readiness")
	}
}
