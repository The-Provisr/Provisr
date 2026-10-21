package statebackend

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"github.com/provisr/backend/internal/cloudaccount"
)

func apiErr(code string) error {
	return &smithy.GenericAPIError{Code: code, Message: "provider detail " + code}
}

type fakeS3 struct {
	exists          bool
	owner           string
	createErr       string
	tags            []s3types.Tag
	versioning      s3types.BucketVersioningStatus
	pab, kms        bool
	policy          string
	region          string
	calls           []string
	createdLocation string
}

func (f *fakeS3) call(name string, owner *string) error {
	f.calls = append(f.calls, name)
	if name != "CreateBucket" && aws.ToString(owner) != f.owner {
		return apiErr("Forbidden")
	}
	return nil
}

func (f *fakeS3) HeadBucket(_ context.Context, in *s3.HeadBucketInput, _ ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	if !f.exists {
		f.calls = append(f.calls, "HeadBucket")
		return nil, apiErr("NotFound")
	}
	return &s3.HeadBucketOutput{}, f.call("HeadBucket", in.ExpectedBucketOwner)
}

func (f *fakeS3) CreateBucket(_ context.Context, in *s3.CreateBucketInput, _ ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
	_ = f.call("CreateBucket", nil)
	if f.createErr != "" {
		if f.createErr == "BucketAlreadyOwnedByYou" {
			f.exists = true
		}
		return nil, apiErr(f.createErr)
	}
	if in.ObjectOwnership != s3types.ObjectOwnershipBucketOwnerEnforced {
		return nil, errors.New("ACLs must be disabled")
	}
	if in.CreateBucketConfiguration != nil {
		f.createdLocation = string(in.CreateBucketConfiguration.LocationConstraint)
	}
	f.exists = true
	return &s3.CreateBucketOutput{}, nil
}

func (f *fakeS3) GetBucketTagging(_ context.Context, in *s3.GetBucketTaggingInput, _ ...func(*s3.Options)) (*s3.GetBucketTaggingOutput, error) {
	if err := f.call("GetBucketTagging", in.ExpectedBucketOwner); err != nil {
		return nil, err
	}
	if len(f.tags) == 0 {
		return nil, apiErr("NoSuchTagSet")
	}
	return &s3.GetBucketTaggingOutput{TagSet: f.tags}, nil
}

func (f *fakeS3) PutBucketTagging(_ context.Context, in *s3.PutBucketTaggingInput, _ ...func(*s3.Options)) (*s3.PutBucketTaggingOutput, error) {
	f.tags = in.Tagging.TagSet
	return &s3.PutBucketTaggingOutput{}, f.call("PutBucketTagging", in.ExpectedBucketOwner)
}

func (f *fakeS3) GetBucketVersioning(_ context.Context, in *s3.GetBucketVersioningInput, _ ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error) {
	return &s3.GetBucketVersioningOutput{Status: f.versioning}, f.call("GetBucketVersioning", in.ExpectedBucketOwner)
}

func (f *fakeS3) PutBucketVersioning(_ context.Context, in *s3.PutBucketVersioningInput, _ ...func(*s3.Options)) (*s3.PutBucketVersioningOutput, error) {
	f.versioning = in.VersioningConfiguration.Status
	return &s3.PutBucketVersioningOutput{}, f.call("PutBucketVersioning", in.ExpectedBucketOwner)
}

func (f *fakeS3) GetPublicAccessBlock(_ context.Context, in *s3.GetPublicAccessBlockInput, _ ...func(*s3.Options)) (*s3.GetPublicAccessBlockOutput, error) {
	if err := f.call("GetPublicAccessBlock", in.ExpectedBucketOwner); err != nil {
		return nil, err
	}
	if !f.pab {
		return nil, apiErr("NoSuchPublicAccessBlockConfiguration")
	}
	t := aws.Bool(true)
	return &s3.GetPublicAccessBlockOutput{PublicAccessBlockConfiguration: &s3types.PublicAccessBlockConfiguration{BlockPublicAcls: t, BlockPublicPolicy: t, IgnorePublicAcls: t, RestrictPublicBuckets: t}}, nil
}

func (f *fakeS3) PutPublicAccessBlock(_ context.Context, in *s3.PutPublicAccessBlockInput, _ ...func(*s3.Options)) (*s3.PutPublicAccessBlockOutput, error) {
	c := in.PublicAccessBlockConfiguration
	f.pab = aws.ToBool(c.BlockPublicAcls) && aws.ToBool(c.BlockPublicPolicy) && aws.ToBool(c.IgnorePublicAcls) && aws.ToBool(c.RestrictPublicBuckets)
	return &s3.PutPublicAccessBlockOutput{}, f.call("PutPublicAccessBlock", in.ExpectedBucketOwner)
}

func (f *fakeS3) GetBucketEncryption(_ context.Context, in *s3.GetBucketEncryptionInput, _ ...func(*s3.Options)) (*s3.GetBucketEncryptionOutput, error) {
	if err := f.call("GetBucketEncryption", in.ExpectedBucketOwner); err != nil {
		return nil, err
	}
	algorithm := s3types.ServerSideEncryptionAes256
	if f.kms {
		algorithm = s3types.ServerSideEncryptionAwsKms
	}
	return &s3.GetBucketEncryptionOutput{ServerSideEncryptionConfiguration: &s3types.ServerSideEncryptionConfiguration{Rules: []s3types.ServerSideEncryptionRule{
		{ApplyServerSideEncryptionByDefault: &s3types.ServerSideEncryptionByDefault{SSEAlgorithm: algorithm}}}}}, nil
}

func (f *fakeS3) PutBucketEncryption(_ context.Context, in *s3.PutBucketEncryptionInput, _ ...func(*s3.Options)) (*s3.PutBucketEncryptionOutput, error) {
	f.kms = in.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm == s3types.ServerSideEncryptionAwsKms
	return &s3.PutBucketEncryptionOutput{}, f.call("PutBucketEncryption", in.ExpectedBucketOwner)
}

func (f *fakeS3) GetBucketPolicy(_ context.Context, in *s3.GetBucketPolicyInput, _ ...func(*s3.Options)) (*s3.GetBucketPolicyOutput, error) {
	if err := f.call("GetBucketPolicy", in.ExpectedBucketOwner); err != nil {
		return nil, err
	}
	if f.policy == "" {
		return nil, apiErr("NoSuchBucketPolicy")
	}
	return &s3.GetBucketPolicyOutput{Policy: &f.policy}, nil
}

func (f *fakeS3) PutBucketPolicy(_ context.Context, in *s3.PutBucketPolicyInput, _ ...func(*s3.Options)) (*s3.PutBucketPolicyOutput, error) {
	f.policy = aws.ToString(in.Policy)
	return &s3.PutBucketPolicyOutput{}, f.call("PutBucketPolicy", in.ExpectedBucketOwner)
}

func (f *fakeS3) mutations() []string {
	out := []string{}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "Put") || strings.HasPrefix(c, "Create") {
			out = append(out, c)
		}
	}
	return out
}

type fakeDynamo struct {
	exists   bool
	statuses []dbtypes.TableStatus
	key      string
	tagWS    string
	created  int
}

func (f *fakeDynamo) DescribeTable(_ context.Context, in *dynamodb.DescribeTableInput, _ ...func(*dynamodb.Options)) (*dynamodb.DescribeTableOutput, error) {
	if !f.exists {
		return nil, apiErr("ResourceNotFoundException")
	}
	status := dbtypes.TableStatusActive
	if len(f.statuses) > 0 {
		status, f.statuses = f.statuses[0], f.statuses[1:]
	}
	return &dynamodb.DescribeTableOutput{Table: &dbtypes.TableDescription{TableName: in.TableName, TableStatus: status, TableArn: aws.String("arn:aws:dynamodb:::table/x"),
		KeySchema:            []dbtypes.KeySchemaElement{{AttributeName: aws.String(f.key), KeyType: dbtypes.KeyTypeHash}},
		AttributeDefinitions: []dbtypes.AttributeDefinition{{AttributeName: aws.String(f.key), AttributeType: dbtypes.ScalarAttributeTypeS}}}}, nil
}

func (f *fakeDynamo) CreateTable(_ context.Context, in *dynamodb.CreateTableInput, _ ...func(*dynamodb.Options)) (*dynamodb.CreateTableOutput, error) {
	if in.BillingMode != dbtypes.BillingModePayPerRequest {
		return nil, errors.New("lock table must be on-demand")
	}
	f.created++
	f.exists = true
	f.key = aws.ToString(in.KeySchema[0].AttributeName)
	for _, tag := range in.Tags {
		if aws.ToString(tag.Key) == tagWorkspace {
			f.tagWS = aws.ToString(tag.Value)
		}
	}
	f.statuses = []dbtypes.TableStatus{dbtypes.TableStatusCreating, dbtypes.TableStatusActive}
	return &dynamodb.CreateTableOutput{}, nil
}

func (f *fakeDynamo) ListTagsOfResource(context.Context, *dynamodb.ListTagsOfResourceInput, ...func(*dynamodb.Options)) (*dynamodb.ListTagsOfResourceOutput, error) {
	return &dynamodb.ListTagsOfResourceOutput{Tags: []dbtypes.Tag{{Key: aws.String(tagWorkspace), Value: aws.String(f.tagWS)}}}, nil
}

type stsHTTP func(*http.Request) (*http.Response, error)

func (f stsHTTP) Do(r *http.Request) (*http.Response, error) { return f(r) }

func driver(t *testing.T, s *fakeS3, d *fakeDynamo, stsOK bool) AWSDriver {
	client := stsHTTP(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "Action=AssumeRole") || !strings.Contains(string(body), "ExternalId=external-test") {
			t.Fatalf("unexpected provider call: %s", body)
		}
		if !stsOK {
			return &http.Response{StatusCode: 403, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
				`<ErrorResponse><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>arn:aws:iam::123456789012:role/secret-role denied</Message></Error></ErrorResponse>`))}, nil
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials><AccessKeyId>delegated-key</AccessKeyId><SecretAccessKey>delegated-secret</SecretAccessKey><SessionToken>delegated-token</SessionToken><Expiration>` + time.Now().Add(time.Hour).UTC().Format(time.RFC3339) + `</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`))}, nil
	})
	return AWSDriver{
		LoadConfig: func(_ context.Context, region string) (aws.Config, error) {
			return aws.Config{Region: region, HTTPClient: client, Credentials: credentials.NewStaticCredentialsProvider("platform-key", "platform-secret", ""), RetryMaxAttempts: 1}, nil
		},
		Clients: func(cfg aws.Config) (s3API, dynamoAPI) {
			creds, err := cfg.Credentials.Retrieve(context.Background())
			if err != nil || creds.AccessKeyID != "delegated-key" {
				t.Fatal("state backend must use delegated credentials, not platform credentials")
			}
			s.region = cfg.Region
			return s, d
		},
		Poll: time.Millisecond,
	}
}

func target(region string) Target {
	return Target{WorkspaceID: workspace, Account: cloudaccount.CapabilityAccount{WorkspaceID: workspace, Provider: "aws",
		RoleARN: "arn:aws:iam::" + accountID + ":role/ProvisrExecutionRole", ExternalID: "external-test", DefaultRegion: region}}
}

func healthy() (*fakeS3, *fakeDynamo) {
	return &fakeS3{exists: true, owner: accountID, versioning: s3types.BucketVersioningStatusEnabled, pab: true, kms: true,
			policy: tlsOnlyPolicy("aws", "b"), tags: []s3types.Tag{{Key: aws.String(tagManaged), Value: aws.String("true")}, {Key: aws.String(tagWorkspace), Value: aws.String(workspace)}}},
		&fakeDynamo{exists: true, key: lockKey, tagWS: workspace}
}

func expectFailure(t *testing.T, err error, code string) {
	t.Helper()
	var f *Failure
	if !errors.As(err, &f) || f.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
	if strings.Contains(err.Error(), "provider detail") || strings.Contains(err.Error(), "secret-role") {
		t.Fatalf("provider error text leaked: %v", err)
	}
}

func TestHealthyBackendIsVerifiedWithoutMutation(t *testing.T) {
	s, d := healthy()
	out, err := driver(t, s, d, true).Ensure(context.Background(), target("us-west-2"))
	if err != nil || out.Created || out.Repaired {
		t.Fatalf("unexpected outcome %+v %v", out, err)
	}
	if m := s.mutations(); len(m) != 0 || d.created != 0 {
		t.Fatalf("healthy backend was mutated: %v", m)
	}
	want, _ := AWSSettings(workspace, accountID, "us-west-2")
	if out.Settings != want || s.region != "us-west-2" {
		t.Fatalf("settings %+v region %s", out.Settings, s.region)
	}
}

func TestFirstRunCreatesHardenedBucketAndLockTable(t *testing.T) {
	s := &fakeS3{owner: accountID}
	d := &fakeDynamo{}
	out, err := driver(t, s, d, true).Ensure(context.Background(), target("eu-west-1"))
	if err != nil || !out.Created || out.Repaired {
		t.Fatalf("unexpected outcome %+v %v", out, err)
	}
	if s.createdLocation != "eu-west-1" || s.versioning != s3types.BucketVersioningStatusEnabled || !s.pab || !s.kms {
		t.Fatalf("bucket not hardened: %+v", s)
	}
	if !strings.Contains(s.policy, `"aws:SecureTransport":"false"`) || !strings.Contains(s.policy, "arn:aws:s3:::"+out.Settings.Bucket+"/*") {
		t.Fatalf("missing TLS-only policy: %s", s.policy)
	}
	if d.created != 1 || d.key != lockKey || d.tagWS != workspace {
		t.Fatalf("lock table not created correctly: %+v", d)
	}
	if strings.Join(s.mutations(), ",") != "CreateBucket,PutBucketTagging,PutPublicAccessBlock,PutBucketVersioning,PutBucketEncryption,PutBucketPolicy" {
		t.Fatalf("unexpected create sequence %v", s.mutations())
	}
}

func TestUSEast1OmitsLocationConstraintAndPartitionIsRespected(t *testing.T) {
	s := &fakeS3{owner: accountID}
	tg := target("us-east-1")
	_, err := driver(t, s, &fakeDynamo{}, true).Ensure(context.Background(), tg)
	if err != nil || s.createdLocation != "" {
		t.Fatalf("us-east-1 must omit LocationConstraint: %q %v", s.createdLocation, err)
	}
	if !strings.Contains(tlsOnlyPolicy("aws-us-gov", "b"), "arn:aws-us-gov:s3:::b") {
		t.Fatal("policy must use the account partition")
	}
}

func TestRecordedRegionIsPinned(t *testing.T) {
	s, d := healthy()
	tg := target("us-west-2")
	tg.Existing = Settings{Region: "eu-central-1"}
	out, err := driver(t, s, d, true).Ensure(context.Background(), tg)
	if err != nil || out.Settings.Region != "eu-central-1" || s.region != "eu-central-1" {
		t.Fatalf("region not pinned: %+v %v", out.Settings, err)
	}
}

func TestCreateRacesAndOwnership(t *testing.T) {
	s := &fakeS3{owner: accountID, createErr: "BucketAlreadyOwnedByYou"}
	if _, err := driver(t, s, &fakeDynamo{}, true).Ensure(context.Background(), target("us-east-1")); err != nil {
		t.Fatalf("own bucket race must succeed: %v", err)
	}
	s = &fakeS3{owner: accountID, createErr: "BucketAlreadyExists"}
	_, err := driver(t, s, &fakeDynamo{}, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_conflict")
	s, d := healthy()
	s.owner = "999999999999"
	_, err = driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_conflict")
	if len(s.mutations()) != 0 {
		t.Fatal("foreign bucket was mutated")
	}
}

func TestDriftOnOwnBucketIsRepaired(t *testing.T) {
	s, d := healthy()
	s.versioning = s3types.BucketVersioningStatusSuspended
	s.policy = ""
	out, err := driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	if err != nil || !out.Repaired || out.Created || s.versioning != s3types.BucketVersioningStatusEnabled || s.policy == "" {
		t.Fatalf("drift not repaired: %+v %v", out, err)
	}
}

func TestWorkspaceTagsGuardAdoption(t *testing.T) {
	s, d := healthy()
	s.tags = []s3types.Tag{{Key: aws.String(tagWorkspace), Value: aws.String(otherWS)}}
	_, err := driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_conflict")
	if len(s.mutations()) != 0 {
		t.Fatal("bucket for another workspace was mutated")
	}
	s, d = healthy()
	s.tags = []s3types.Tag{{Key: aws.String("team"), Value: aws.String("ops")}}
	if _, err = driver(t, s, d, true).Ensure(context.Background(), target("us-east-1")); err != nil {
		t.Fatalf("untagged owned bucket must be adopted: %v", err)
	}
	if len(s.tags) != 3 || aws.ToString(s.tags[0].Key) != "team" {
		t.Fatalf("adoption must keep existing tags: %+v", s.tags)
	}
	s, d = healthy()
	d.tagWS = otherWS
	_, err = driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_conflict")
}

func TestLockTableMustBeTerraformCompatible(t *testing.T) {
	s, d := healthy()
	d.key = "id"
	_, err := driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_unavailable")
	s, d = healthy()
	d.statuses = []dbtypes.TableStatus{dbtypes.TableStatusDeleting}
	_, err = driver(t, s, d, true).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_unavailable")
}

func TestDelegatedAccessFailureFailsClosedWithoutLeaking(t *testing.T) {
	s, d := healthy()
	_, err := driver(t, s, d, false).Ensure(context.Background(), target("us-east-1"))
	expectFailure(t, err, "backend_unavailable")
	if len(s.calls) != 0 {
		t.Fatal("S3 called without delegated credentials")
	}
	tg := target("us-east-1")
	tg.Account.ExternalID = ""
	_, err = driver(t, s, d, true).Ensure(context.Background(), tg)
	expectFailure(t, err, "backend_unavailable")
}

func TestUnonboardedProvidersFailClosed(t *testing.T) {
	_, err := unonboarded{}.Ensure(context.Background(), Target{})
	expectFailure(t, err, "provider_not_onboarded")
}
