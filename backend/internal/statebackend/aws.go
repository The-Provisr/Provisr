package statebackend

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"github.com/provisr/backend/internal/cloudaccount"
)

// s3API is the subset of S3 the driver uses; a test seam.
type s3API interface {
	HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
	CreateBucket(context.Context, *s3.CreateBucketInput, ...func(*s3.Options)) (*s3.CreateBucketOutput, error)
	GetBucketTagging(context.Context, *s3.GetBucketTaggingInput, ...func(*s3.Options)) (*s3.GetBucketTaggingOutput, error)
	PutBucketTagging(context.Context, *s3.PutBucketTaggingInput, ...func(*s3.Options)) (*s3.PutBucketTaggingOutput, error)
	GetBucketVersioning(context.Context, *s3.GetBucketVersioningInput, ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error)
	PutBucketVersioning(context.Context, *s3.PutBucketVersioningInput, ...func(*s3.Options)) (*s3.PutBucketVersioningOutput, error)
	GetPublicAccessBlock(context.Context, *s3.GetPublicAccessBlockInput, ...func(*s3.Options)) (*s3.GetPublicAccessBlockOutput, error)
	PutPublicAccessBlock(context.Context, *s3.PutPublicAccessBlockInput, ...func(*s3.Options)) (*s3.PutPublicAccessBlockOutput, error)
	GetBucketEncryption(context.Context, *s3.GetBucketEncryptionInput, ...func(*s3.Options)) (*s3.GetBucketEncryptionOutput, error)
	PutBucketEncryption(context.Context, *s3.PutBucketEncryptionInput, ...func(*s3.Options)) (*s3.PutBucketEncryptionOutput, error)
	GetBucketPolicy(context.Context, *s3.GetBucketPolicyInput, ...func(*s3.Options)) (*s3.GetBucketPolicyOutput, error)
	PutBucketPolicy(context.Context, *s3.PutBucketPolicyInput, ...func(*s3.Options)) (*s3.PutBucketPolicyOutput, error)
}

// dynamoAPI is the subset of DynamoDB the driver uses; a test seam.
type dynamoAPI interface {
	DescribeTable(context.Context, *dynamodb.DescribeTableInput, ...func(*dynamodb.Options)) (*dynamodb.DescribeTableOutput, error)
	CreateTable(context.Context, *dynamodb.CreateTableInput, ...func(*dynamodb.Options)) (*dynamodb.CreateTableOutput, error)
	ListTagsOfResource(context.Context, *dynamodb.ListTagsOfResourceInput, ...func(*dynamodb.Options)) (*dynamodb.ListTagsOfResourceOutput, error)
}

// AWSDriver manages an S3 state bucket with DynamoDB locking using fresh
// 15-minute delegated credentials that are never stored.
type AWSDriver struct {
	// LoadConfig is a test seam; production uses the runtime identity chain.
	LoadConfig func(context.Context, string) (aws.Config, error)
	// Clients is a test seam; production builds SDK clients from the assumed config.
	Clients func(aws.Config) (s3API, dynamoAPI)
	// Poll bounds lock table activation; zero uses production timing.
	Poll time.Duration
}

const (
	tagManaged   = "provisr:managed"
	tagWorkspace = "provisr:workspace"
	policySid    = "ProvisrDenyInsecureTransport"
	lockKey      = "LockID"
)

func (d AWSDriver) Ensure(ctx context.Context, t Target) (Outcome, error) {
	accountID, ok := cloudaccount.AWSAccountID(t.Account.RoleARN)
	if !ok {
		return Outcome{}, errUnavailable
	}
	cfg, err := cloudaccount.AssumeAWS(ctx, t.Account, "provisr-state-backend", d.LoadConfig)
	if err != nil {
		return Outcome{}, errUnavailable
	}
	// Recorded settings pin the bucket region even if the account default changes.
	region := t.Existing.Region
	if region == "" {
		region = cfg.Region
	}
	settings, err := AWSSettings(t.WorkspaceID, accountID, region)
	if err != nil {
		return Outcome{}, errUnavailable
	}
	cfg.Region = region
	clients := d.Clients
	if clients == nil {
		clients = sdkClients
	}
	s3c, ddb := clients(cfg)
	out := Outcome{Settings: settings}
	b := bucket{api: s3c, name: settings.Bucket, owner: accountID, region: region, workspace: t.WorkspaceID,
		partition: strings.Split(t.Account.RoleARN, ":")[1]}
	if out.Created, out.Repaired, err = b.ensure(ctx); err != nil {
		return Outcome{}, err
	}
	poll := d.Poll
	if poll == 0 {
		poll = 2 * time.Second
	}
	l := lockTable{api: ddb, name: settings.LockTable, workspace: t.WorkspaceID, poll: poll}
	created, err := l.ensure(ctx)
	if err != nil {
		return Outcome{}, err
	}
	out.Created = out.Created || created
	return out, nil
}

func sdkClients(cfg aws.Config) (s3API, dynamoAPI) {
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		// Local S3 emulators (localstack) do not serve virtual-hosted buckets.
		o.UsePathStyle = os.Getenv("AWS_ENDPOINT_URL") != ""
	}), dynamodb.NewFromConfig(cfg)
}

func apiCode(err error) string {
	var api smithy.APIError
	if errors.As(err, &api) {
		return api.ErrorCode()
	}
	return ""
}

type bucket struct {
	api                                       s3API
	name, owner, region, workspace, partition string
}

// ensure proves ownership before reading or repairing anything. ExpectedBucketOwner
// makes S3 reject buckets held by any account other than the connected one.
func (b bucket) ensure(ctx context.Context) (created, repaired bool, err error) {
	_, err = b.api.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	switch code := apiCode(err); {
	case err == nil:
	case code == "NotFound" || code == "NoSuchBucket":
		if err = b.create(ctx); err != nil {
			return false, false, err
		}
		created = true
	case code == "Forbidden" || code == "AccessDenied":
		return false, false, errConflict
	default:
		return false, false, errUnavailable
	}
	if err = b.claim(ctx); err != nil {
		return false, false, err
	}
	drifted, err := b.drifted(ctx)
	if err != nil {
		return false, false, err
	}
	if !drifted {
		return created, false, nil
	}
	if err = b.harden(ctx); err != nil {
		return false, false, err
	}
	if drifted, err = b.drifted(ctx); err != nil || drifted {
		return false, false, errUnavailable
	}
	return created, !created, nil
}

func (b bucket) create(ctx context.Context) error {
	input := &s3.CreateBucketInput{Bucket: &b.name, ObjectOwnership: s3types.ObjectOwnershipBucketOwnerEnforced}
	if b.region != "us-east-1" {
		input.CreateBucketConfiguration = &s3types.CreateBucketConfiguration{LocationConstraint: s3types.BucketLocationConstraint(b.region)}
	}
	_, err := b.api.CreateBucket(ctx, input)
	switch apiCode(err) {
	case "":
		if err != nil {
			return errUnavailable
		}
	case "BucketAlreadyOwnedByYou":
	case "BucketAlreadyExists":
		return errConflict
	default:
		return errUnavailable
	}
	return nil
}

// claim tags an owned bucket. An untagged bucket owned by the connected account
// with this workspace-derived name is adopted (e.g. a crash after CreateBucket);
// one tagged for a different workspace fails closed.
func (b bucket) claim(ctx context.Context) error {
	tags, err := b.api.GetBucketTagging(ctx, &s3.GetBucketTaggingInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	if err != nil && apiCode(err) != "NoSuchTagSet" {
		return errUnavailable
	}
	set := []s3types.Tag{}
	if tags != nil {
		set = tags.TagSet
	}
	found := map[string]string{}
	for _, tag := range set {
		found[aws.ToString(tag.Key)] = aws.ToString(tag.Value)
	}
	if ws, ok := found[tagWorkspace]; ok && ws != b.workspace {
		return errConflict
	}
	if found[tagManaged] == "true" && found[tagWorkspace] == b.workspace {
		return nil
	}
	kept := []s3types.Tag{}
	for _, tag := range set {
		if k := aws.ToString(tag.Key); k != tagManaged && k != tagWorkspace {
			kept = append(kept, tag)
		}
	}
	kept = append(kept, s3types.Tag{Key: aws.String(tagManaged), Value: aws.String("true")},
		s3types.Tag{Key: aws.String(tagWorkspace), Value: aws.String(b.workspace)})
	if _, err = b.api.PutBucketTagging(ctx, &s3.PutBucketTaggingInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner, Tagging: &s3types.Tagging{TagSet: kept}}); err != nil {
		return errUnavailable
	}
	return nil
}

// drifted reports whether versioning, public access blocking, KMS encryption or
// the TLS-only policy is missing. Missing configuration is drift, not an error.
func (b bucket) drifted(ctx context.Context) (bool, error) {
	versioning, err := b.api.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	if err != nil {
		return false, errUnavailable
	}
	if versioning.Status != s3types.BucketVersioningStatusEnabled {
		return true, nil
	}
	pab, err := b.api.GetPublicAccessBlock(ctx, &s3.GetPublicAccessBlockInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	if apiCode(err) == "NoSuchPublicAccessBlockConfiguration" {
		return true, nil
	}
	if err != nil {
		return false, errUnavailable
	}
	c := pab.PublicAccessBlockConfiguration
	if c == nil || !aws.ToBool(c.BlockPublicAcls) || !aws.ToBool(c.BlockPublicPolicy) || !aws.ToBool(c.IgnorePublicAcls) || !aws.ToBool(c.RestrictPublicBuckets) {
		return true, nil
	}
	enc, err := b.api.GetBucketEncryption(ctx, &s3.GetBucketEncryptionInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	if apiCode(err) == "ServerSideEncryptionConfigurationNotFoundError" {
		return true, nil
	}
	if err != nil {
		return false, errUnavailable
	}
	kms := false
	if enc.ServerSideEncryptionConfiguration != nil {
		for _, rule := range enc.ServerSideEncryptionConfiguration.Rules {
			if d := rule.ApplyServerSideEncryptionByDefault; d != nil && d.SSEAlgorithm == s3types.ServerSideEncryptionAwsKms {
				kms = true
			}
		}
	}
	if !kms {
		return true, nil
	}
	policy, err := b.api.GetBucketPolicy(ctx, &s3.GetBucketPolicyInput{Bucket: &b.name, ExpectedBucketOwner: &b.owner})
	if apiCode(err) == "NoSuchBucketPolicy" {
		return true, nil
	}
	if err != nil {
		return false, errUnavailable
	}
	return !strings.Contains(aws.ToString(policy.Policy), `"`+policySid+`"`), nil
}

func (b bucket) harden(ctx context.Context) error {
	owner := &b.owner
	if _, err := b.api.PutPublicAccessBlock(ctx, &s3.PutPublicAccessBlockInput{Bucket: &b.name, ExpectedBucketOwner: owner,
		PublicAccessBlockConfiguration: &s3types.PublicAccessBlockConfiguration{BlockPublicAcls: aws.Bool(true),
			BlockPublicPolicy: aws.Bool(true), IgnorePublicAcls: aws.Bool(true), RestrictPublicBuckets: aws.Bool(true)}}); err != nil {
		return errUnavailable
	}
	// Versioning lets operators recover a corrupted or overwritten state file.
	if _, err := b.api.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{Bucket: &b.name, ExpectedBucketOwner: owner,
		VersioningConfiguration: &s3types.VersioningConfiguration{Status: s3types.BucketVersioningStatusEnabled}}); err != nil {
		return errUnavailable
	}
	if _, err := b.api.PutBucketEncryption(ctx, &s3.PutBucketEncryptionInput{Bucket: &b.name, ExpectedBucketOwner: owner,
		ServerSideEncryptionConfiguration: &s3types.ServerSideEncryptionConfiguration{Rules: []s3types.ServerSideEncryptionRule{{
			ApplyServerSideEncryptionByDefault: &s3types.ServerSideEncryptionByDefault{SSEAlgorithm: s3types.ServerSideEncryptionAwsKms},
			BucketKeyEnabled:                   aws.Bool(true)}}}}); err != nil {
		return errUnavailable
	}
	if _, err := b.api.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{Bucket: &b.name, ExpectedBucketOwner: owner, Policy: aws.String(tlsOnlyPolicy(b.partition, b.name))}); err != nil {
		return errUnavailable
	}
	return nil
}

func tlsOnlyPolicy(partition, bucket string) string {
	arn := "arn:" + partition + ":s3:::" + bucket
	return `{"Version":"2012-10-17","Statement":[{"Sid":"` + policySid + `","Effect":"Deny","Principal":"*","Action":"s3:*",` +
		`"Resource":["` + arn + `","` + arn + `/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}`
}

type lockTable struct {
	api             dynamoAPI
	name, workspace string
	poll            time.Duration
}

// ensure creates the Terraform lock table on first run; its LockID conditional
// writes are what prevent two applies holding the same state concurrently.
func (l lockTable) ensure(ctx context.Context) (bool, error) {
	created := false
	desc, err := l.api.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &l.name})
	if apiCode(err) == "ResourceNotFoundException" {
		created = true
		_, err = l.api.CreateTable(ctx, &dynamodb.CreateTableInput{
			TableName:            &l.name,
			AttributeDefinitions: []dbtypes.AttributeDefinition{{AttributeName: aws.String(lockKey), AttributeType: dbtypes.ScalarAttributeTypeS}},
			KeySchema:            []dbtypes.KeySchemaElement{{AttributeName: aws.String(lockKey), KeyType: dbtypes.KeyTypeHash}},
			// DynamoDB always encrypts at rest; the table holds lock IDs and
			// digests only, never state, so no customer KMS grant is required.
			BillingMode: dbtypes.BillingModePayPerRequest,
			Tags: []dbtypes.Tag{{Key: aws.String(tagManaged), Value: aws.String("true")},
				{Key: aws.String(tagWorkspace), Value: aws.String(l.workspace)}},
		})
		if err != nil && apiCode(err) != "ResourceInUseException" {
			return false, errUnavailable
		}
		desc, err = l.api.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &l.name})
	}
	for attempt := 0; err == nil && desc.Table != nil && desc.Table.TableStatus != dbtypes.TableStatusActive; attempt++ {
		if desc.Table.TableStatus != dbtypes.TableStatusCreating || attempt >= 30 {
			return false, errUnavailable
		}
		select {
		case <-ctx.Done():
			return false, errUnavailable
		case <-time.After(l.poll):
		}
		desc, err = l.api.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &l.name})
	}
	if err != nil || desc.Table == nil || !lockSchema(desc.Table) {
		return false, errUnavailable
	}
	tags, err := l.api.ListTagsOfResource(ctx, &dynamodb.ListTagsOfResourceInput{ResourceArn: desc.Table.TableArn})
	if err != nil {
		return false, errUnavailable
	}
	for _, tag := range tags.Tags {
		if aws.ToString(tag.Key) == tagWorkspace && aws.ToString(tag.Value) != l.workspace {
			return false, errConflict
		}
	}
	return created, nil
}

func lockSchema(t *dbtypes.TableDescription) bool {
	if len(t.KeySchema) != 1 || aws.ToString(t.KeySchema[0].AttributeName) != lockKey || t.KeySchema[0].KeyType != dbtypes.KeyTypeHash {
		return false
	}
	for _, a := range t.AttributeDefinitions {
		if aws.ToString(a.AttributeName) == lockKey {
			return a.AttributeType == dbtypes.ScalarAttributeTypeS
		}
	}
	return false
}
