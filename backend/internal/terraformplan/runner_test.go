package terraformplan

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/provisr/backend/internal/iacartifact"
	"github.com/provisr/backend/internal/terraform"
)

func bundle(files ...terraform.File) *iacartifact.Artifact {
	h := sha256.New()
	for _, f := range files {
		_, _ = h.Write([]byte(f.Path + "\x00" + f.Content + "\x00"))
	}
	return &iacartifact.Artifact{Files: files, Hash: hex.EncodeToString(h.Sum(nil))}
}

func TestMaterializeRejectsTraversalAndTampering(t *testing.T) {
	for _, path := range []string{"../main.tf", "/tmp/main.tf", "resources/../../escape.tf", "resources/nested/file.tf", "main.tf\x00"} {
		if materialize(t.TempDir(), bundle(terraform.File{Path: path, Content: "x"})) == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	a := bundle(terraform.File{Path: "main.tf", Content: "safe"})
	a.Files[0].Content = "changed"
	if materialize(t.TempDir(), a) == nil {
		t.Fatal("accepted changed content")
	}
	a = bundle(terraform.File{Path: "main.tf", Content: "safe"})
	dir := t.TempDir()
	if err := materialize(dir, a); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(dir, "main.tf"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("unsafe file permissions")
	}
}

func TestCommandsUsePrivateEnvironmentAndCleanFiles(t *testing.T) {
	t.Setenv("TF_CLI_ARGS", "-destroy")
	t.Setenv("TF_LOG", "TRACE")
	t.Setenv("AWS_PROFILE", "unsafe")
	trace := filepath.Join(t.TempDir(), "trace")
	script := filepath.Join(t.TempDir(), "terraform")
	code := "#!/bin/sh\n[ -z \"$TF_CLI_ARGS$TF_LOG$AWS_PROFILE\" ] || exit 9\n[ \"$AWS_SESSION_TOKEN\" = delegated ] || exit 8\nprintf '%s %s\\n' \"$PWD\" \"$*\" >> '" + trace + "'\ncase \"$1\" in\nplan) printf binary > plan.tfplan;;\nshow) printf '%s' '{\"format_version\":\"1.2\",\"planned_values\":{}}';;\nesac\n"
	if err := os.WriteFile(script, []byte(code), 0700); err != nil {
		t.Fatal(err)
	}
	a := bundle(terraform.File{Path: "main.tf", Content: "# reviewed"})
	out, err := (CommandRunner{Binary: script}).Plan(context.Background(), a, map[string]string{"bucket": "controlled"}, []string{"AWS_ACCESS_KEY_ID=test", "AWS_SECRET_ACCESS_KEY=test", "AWS_SESSION_TOKEN=delegated"})
	if err != nil {
		t.Fatal(err)
	}
	if string(out.Binary) != "binary" {
		t.Fatal("missing saved plan")
	}
	log, _ := os.ReadFile(trace)
	lines := strings.Split(strings.TrimSpace(string(log)), "\n")
	if len(lines) != 3 || !strings.Contains(lines[0], "init -input=false") || !strings.Contains(lines[1], "plan -input=false") || !strings.Contains(lines[2], "show -json plan.tfplan") {
		t.Fatalf("unexpected commands: %s", log)
	}
	dir := strings.SplitN(lines[0], " ", 2)[0]
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("temporary directory retained")
	}
}

func TestTerraformFailureAndCancellationAreSanitized(t *testing.T) {
	script := filepath.Join(t.TempDir(), "terraform")
	_ = os.WriteFile(script, []byte("#!/bin/sh\nprintf 'secret-password' >&2\nexit 1\n"), 0700)
	_, err := (CommandRunner{Binary: script}).Plan(context.Background(), bundle(terraform.File{Path: "main.tf", Content: "#safe"}), map[string]string{"bucket": "controlled"}, nil)
	var f *Failure
	if !errors.As(err, &f) || f.Stage != "init" || strings.Contains(err.Error(), "secret-password") {
		t.Fatalf("unsafe failure %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err = (CommandRunner{Binary: script}).Plan(ctx, bundle(terraform.File{Path: "main.tf", Content: "#safe"}), map[string]string{"bucket": "controlled"}, nil)
	if err == nil || time.Since(start) > time.Second {
		t.Fatal("cancellation ignored")
	}
}

// Uses Terraform's built-in terraform_data provider and a local backend solely
// inside the test fixture. Production bundles/manager always select remote state.
func TestRealTerraformPlanWithoutCloud(t *testing.T) {
	binary := os.Getenv("TEST_TERRAFORM_BINARY")
	if binary == "" {
		t.Skip("TEST_TERRAFORM_BINARY enables provider-free CLI proof")
	}
	content := "terraform {\n backend \"local\" {}\n}\nresource \"terraform_data\" \"example\" { input = \"safe\" }\n"
	out, err := (CommandRunner{Binary: binary}).Plan(context.Background(), bundle(terraform.File{Path: "main.tf", Content: content}), map[string]string{"path": filepath.Join(t.TempDir(), "state")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	summary, _, err := Normalize(out.JSON)
	if err != nil || summary.CreateCount != 1 || len(out.Binary) == 0 {
		t.Fatalf("missing real plan: %+v %v", summary, err)
	}
}

func TestCancellationStopsProviderDescendants(t *testing.T) {
	dir := t.TempDir()
	marker, ready := filepath.Join(dir, "provider-survived"), filepath.Join(dir, "ready")
	script := filepath.Join(dir, "terraform")
	code := "#!/bin/sh\n(sleep 0.4; printf leaked > '" + marker + "') &\nprintf ready > '" + ready + "'\nwait\n"
	if err := os.WriteFile(script, []byte(code), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := (CommandRunner{Binary: script}).Plan(ctx, bundle(terraform.File{Path: "main.tf", Content: "# safe"}), map[string]string{"bucket": "controlled"}, nil)
		done <- err
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake provider did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled planning succeeded")
	}
	time.Sleep(500 * time.Millisecond)
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("provider descendant survived cancellation")
	}
}
