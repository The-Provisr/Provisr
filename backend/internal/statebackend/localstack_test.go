package statebackend

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestAWSDriverAgainstLocalStack exercises real SDK calls and error codes.
// Run with STATEBACKEND_LOCALSTACK=1, AWS_ENDPOINT_URL pointing at LocalStack
// (s3, dynamodb, sts enabled) and dummy AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.
func TestAWSDriverAgainstLocalStack(t *testing.T) {
	if os.Getenv("STATEBACKEND_LOCALSTACK") != "1" || os.Getenv("AWS_ENDPOINT_URL") == "" {
		t.Skip("STATEBACKEND_LOCALSTACK=1 and AWS_ENDPOINT_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	tg := target("eu-west-1")
	// Fresh workspace per run so the first call always creates.
	tg.WorkspaceID = time.Now().UTC().Format("20060102150405.000000000")
	d := AWSDriver{Poll: 200 * time.Millisecond}
	first, err := d.Ensure(ctx, tg)
	if err != nil || !first.Created {
		t.Fatalf("first run: %+v %v", first, err)
	}
	tg.Existing = first.Settings
	second, err := d.Ensure(ctx, tg)
	if err != nil || second.Created || second.Repaired || second.Settings != first.Settings {
		t.Fatalf("second run must verify without changes: %+v %v", second, err)
	}
	other := tg
	other.WorkspaceID = tg.WorkspaceID + "-other"
	if _, err = d.Ensure(ctx, other); err != nil {
		t.Fatalf("second workspace in same account: %v", err)
	}
}
