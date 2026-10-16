package cloudaccount

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// AWSDiscovery obtains fresh, short-lived credentials and never stores them.
type AWSDiscovery struct {
	// LoadConfig is a test seam; production uses the standard short-lived runtime identity chain.
	LoadConfig func(context.Context, string) (aws.Config, error)
}

var discoveryRegion = regexp.MustCompile(`^[a-z]{2}(?:-[a-z]+)+-[0-9]+$`)
var readinessActions = []string{"ec2:RunInstances", "ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateSecurityGroup", "s3:CreateBucket", "rds:CreateDBInstance"}

func (d AWSDiscovery) Discover(ctx context.Context, a CapabilityAccount) (Discovery, error) {
	if !roleARNRegex.MatchString(a.RoleARN) || a.ExternalID == "" {
		return Discovery{}, errors.New("delegated identity unavailable")
	}
	region := a.DefaultRegion
	if region == "" {
		region = "us-east-1"
		if strings.HasPrefix(a.RoleARN, "arn:aws-cn:") {
			region = "cn-north-1"
		}
		if strings.HasPrefix(a.RoleARN, "arn:aws-us-gov:") {
			region = "us-gov-west-1"
		}
	}
	if !discoveryRegion.MatchString(region) {
		return Discovery{}, errors.New("invalid discovery region")
	}
	load := d.LoadConfig
	if load == nil {
		load = func(ctx context.Context, region string) (aws.Config, error) {
			return config.LoadDefaultConfig(ctx, config.WithRegion(region), config.WithRetryMaxAttempts(1))
		}
	}
	cfg, err := load(ctx, region)
	if err != nil {
		return Discovery{}, errors.New("provider configuration unavailable")
	}
	assumed, err := sts.NewFromConfig(cfg).AssumeRole(ctx, &sts.AssumeRoleInput{RoleArn: aws.String(a.RoleARN), ExternalId: aws.String(a.ExternalID), RoleSessionName: aws.String("provisr-capabilities"), DurationSeconds: aws.Int32(900)})
	if err != nil || assumed.Credentials == nil {
		return Discovery{}, errors.New("delegated access unavailable")
	}
	c := assumed.Credentials
	if c.AccessKeyId == nil || c.SecretAccessKey == nil || c.SessionToken == nil || c.Expiration == nil || !c.Expiration.After(time.Now()) {
		return Discovery{}, errors.New("delegated credentials unavailable")
	}
	cfg.Credentials = credentials.NewStaticCredentialsProvider(*c.AccessKeyId, *c.SecretAccessKey, *c.SessionToken)
	regions, err := describeAWSRegions(ctx, cfg)
	if err != nil {
		return Discovery{}, errors.New("region discovery unavailable")
	}
	facts := Discovery{AccountID: roleARNRegex.FindStringSubmatch(a.RoleARN)[1], Regions: regions}
	// Simulation is advisory readiness, never execution authorization. Missing
	// context, denies, pagination or unavailable IAM access all keep readiness false.
	simulated, err := iam.NewFromConfig(cfg).SimulatePrincipalPolicy(ctx, &iam.SimulatePrincipalPolicyInput{PolicySourceArn: aws.String(a.RoleARN), ActionNames: readinessActions, ResourceArns: []string{"*"}})
	if err == nil && !simulated.IsTruncated && len(simulated.EvaluationResults) == len(readinessActions) {
		allowed := map[string]bool{}
		for _, r := range simulated.EvaluationResults {
			if r.EvalActionName != nil && string(r.EvalDecision) == "allowed" && len(r.MissingContextValues) == 0 {
				allowed[*r.EvalActionName] = true
			}
		}
		facts.PermissionsVerified = true
		for _, action := range readinessActions {
			if !allowed[action] {
				facts.PermissionsVerified = false
			}
		}
	}
	return facts, nil
}

func describeAWSRegions(ctx context.Context, cfg aws.Config) ([]string, error) {
	suffix := "amazonaws.com"
	if strings.HasPrefix(cfg.Region, "cn-") {
		suffix += ".cn"
	}
	body := url.Values{"Action": {"DescribeRegions"}, "Version": {"2016-11-15"}, "AllRegions": {"false"}}.Encode()
	r, err := http.NewRequestWithContext(ctx, "POST", "https://ec2."+cfg.Region+"."+suffix, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	creds, err := cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(body))
	if err := v4.NewSigner().SignHTTP(ctx, creds, r, hex.EncodeToString(hash[:]), "ec2", cfg.Region, time.Now()); err != nil {
		return nil, err
	}
	response, err := cfg.HTTPClient.Do(r)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("region discovery failed")
	}
	var payload struct {
		Items []struct {
			Name   string `xml:"regionName"`
			Status string `xml:"optInStatus"`
		} `xml:"regionInfo>item"`
	}
	if err := xml.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	regions := []string{}
	seen := map[string]bool{}
	for _, item := range payload.Items {
		if discoveryRegion.MatchString(item.Name) && (item.Status == "opt-in-not-required" || item.Status == "opted-in") && !seen[item.Name] {
			regions = append(regions, item.Name)
			seen[item.Name] = true
		}
	}
	sort.Strings(regions)
	if len(regions) == 0 {
		return nil, errors.New("no available regions")
	}
	return regions, nil
}
