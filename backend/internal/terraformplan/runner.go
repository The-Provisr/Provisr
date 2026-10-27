package terraformplan

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/internal/iacartifact"
	"github.com/provisr/backend/internal/statebackend"
)

type Output struct{ JSON, Binary []byte }
type Runner interface {
	Plan(context.Context, *iacartifact.Artifact, map[string]string, []string) (Output, error)
}
type CommandRunner struct{ Binary string }

func delegatedAWS(ctx context.Context, a cloudaccount.CapabilityAccount) ([]string, error) {
	cfg, err := cloudaccount.AssumeAWS(ctx, a, "provisr-terraform-plan", nil)
	if err != nil {
		return nil, err
	}
	c, err := cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, err
	}
	if c.AccessKeyID == "" || c.SecretAccessKey == "" || c.SessionToken == "" {
		return nil, errors.New("delegated credentials unavailable")
	}
	return []string{"AWS_ACCESS_KEY_ID=" + c.AccessKeyID, "AWS_SECRET_ACCESS_KEY=" + c.SecretAccessKey, "AWS_SESSION_TOKEN=" + c.SessionToken}, nil
}

// Materialize accepts only the fixed BE-D04 bundle layout, verifies its digest,
// and creates private regular files. No caller-selected commands or archives.
func materialize(dir string, a *iacartifact.Artifact) error {
	if len(a.Files) == 0 || len(a.Files) > 64 {
		return errors.New("invalid artifact files")
	}
	h := sha256.New()
	total := 0
	seen := map[string]bool{}
	for _, f := range a.Files {
		allowed := f.Path == "main.tf" || f.Path == "variables.tf" || f.Path == "outputs.tf" || f.Path == "terraform.tfvars"
		if strings.HasPrefix(f.Path, "resources/") && strings.Count(f.Path, "/") == 1 && strings.HasSuffix(f.Path, ".tf") && !strings.ContainsAny(f.Path, "\\\x00") {
			allowed = true
		}
		if !allowed || filepath.Clean(f.Path) != f.Path || seen[f.Path] || strings.Contains(f.Path, "..") {
			return errors.New("invalid artifact path")
		}
		seen[f.Path] = true
		total += len(f.Content)
		if total > 4<<20 {
			return errors.New("artifact too large")
		}
		_, _ = h.Write([]byte(f.Path + "\x00" + f.Content + "\x00"))
	}
	if !seen["main.tf"] || hex.EncodeToString(h.Sum(nil)) != a.Hash {
		return errors.New("artifact integrity mismatch")
	}
	for _, f := range a.Files {
		path := filepath.Join(dir, f.Path)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(f.Content), 0600); err != nil {
			return err
		}
	}
	return nil
}

// cappedBuffer fails closed on excessive provider output without retaining logs.
type cappedBuffer struct {
	data  []byte
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	if len(b.data)+len(p) > b.limit {
		return 0, errors.New("Terraform output limit exceeded")
	}
	b.data = append(b.data, p...)
	return len(p), nil
}

func (r CommandRunner) Plan(ctx context.Context, a *iacartifact.Artifact, backend map[string]string, credentials []string) (Output, error) {
	dir, err := os.MkdirTemp("", "provisr-plan-")
	if err != nil {
		return Output{}, err
	}
	defer os.RemoveAll(dir)
	if err = materialize(dir, a); err != nil {
		return Output{}, fail(422, "invalid_artifact", "Stored Terraform artifact failed integrity checks")
	}
	if len(backend) == 0 {
		return Output{}, fail(503, "backend_unavailable", "Controlled remote backend required")
	}
	if err = os.WriteFile(filepath.Join(dir, "backend.hcl"), []byte(statebackend.HCL(backend)), 0600); err != nil {
		return Output{}, err
	}
	// Avoid ambient TF_CLI_ARGS, TF_LOG, cloud profiles and credentials. HOME and
	// Terraform CLI config are private, so user plugins/credential helpers cannot load.
	if err = os.WriteFile(filepath.Join(dir, "terraform.rc"), nil, 0600); err != nil {
		return Output{}, err
	}
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "TMPDIR=" + dir, "TF_IN_AUTOMATION=1", "TF_INPUT=0", "TF_CLI_CONFIG_FILE=" + filepath.Join(dir, "terraform.rc"), "CHECKPOINT_DISABLE=1", "AWS_EC2_METADATA_DISABLED=true"}
	for _, v := range credentials {
		if !strings.HasPrefix(v, "AWS_ACCESS_KEY_ID=") && !strings.HasPrefix(v, "AWS_SECRET_ACCESS_KEY=") && !strings.HasPrefix(v, "AWS_SESSION_TOKEN=") {
			return Output{}, errors.New("invalid credential environment")
		}
		env = append(env, v)
	}
	binary := r.Binary
	if binary == "" {
		binary = "terraform"
	}
	run := func(stage string, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Dir = dir
		cmd.Env = env
		cmd.WaitDelay = 2 * time.Second
		// Terraform providers are child processes holding delegated credentials.
		// Cancel the entire group, not just the parent Terraform process.
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error {
			err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			if errors.Is(err, syscall.ESRCH) {
				return os.ErrProcessDone
			}
			return err
		}
		out := &cappedBuffer{limit: 16 << 20}
		cmd.Stdout = out
		cmd.Stderr = io.Discard
		if err := cmd.Run(); err != nil {
			return nil, &Failure{Status: 422, Code: "terraform_" + stage + "_failed", Message: "Terraform " + stage + " failed; check artifact and delegated permissions", Stage: stage}
		}
		return out.data, nil
	}
	if _, err = run("init", "init", "-input=false", "-no-color", "-backend-config=backend.hcl"); err != nil {
		return Output{}, err
	}
	if _, err = run("plan", "plan", "-input=false", "-no-color", "-lock-timeout=10s", "-out=plan.tfplan"); err != nil {
		return Output{}, err
	}
	raw, err := run("show", "show", "-json", "plan.tfplan")
	if err != nil {
		return Output{}, err
	}
	file, err := os.Open(filepath.Join(dir, "plan.tfplan"))
	if err != nil {
		return Output{}, err
	}
	defer file.Close()
	b, err := io.ReadAll(io.LimitReader(file, (16<<20)+1))
	if err != nil || len(b) == 0 || len(b) > 16<<20 {
		return Output{}, fail(422, "invalid_plan", "Generated plan exceeds size limits")
	}
	return Output{JSON: raw, Binary: b}, nil
}
