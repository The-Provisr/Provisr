package terraform

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestBundleLoadsDomainsAndPreservesIntent(t *testing.T) {
	m := input("storage.aws.s3", map[string]any{"name": "example.bucket", "versioning": false})
	a, err := Bundle(m)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Bundle(m)
	if err != nil || !reflect.DeepEqual(a, b) {
		t.Fatal("non-deterministic bundle", err)
	}
	files := map[string]string{}
	dir := t.TempDir()
	for _, f := range a.Files {
		files[f.Path] = f.Content
		target := filepath.Join(dir, f.Path)
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(target, []byte(f.Content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if len(files) != 7 || !strings.Contains(files["main.tf"], `source = "./resources"`) || !strings.Contains(files["terraform.tfvars"], `"bucket":"example.bucket"`) || !strings.Contains(files["resources/storage.tf"], `bucket = var.r_app["bucket"]`) || !strings.Contains(files["resources/storage.tf"], `"Suspended"`) {
		t.Fatalf("incomplete module: %+v", files)
	}
	if m.Resources[0].Properties["name"] != "example.bucket" || m.Resources[0].Properties["bucket"] != nil {
		t.Fatal("manifest mutated")
	}
	if binary, err := exec.LookPath("terraform"); err == nil {
		if output, err := exec.Command(binary, "fmt", "-recursive", "-write=false", dir).CombinedOutput(); err != nil {
			t.Fatalf("invalid HCL: %s", output)
		}
	}
}

func TestBundleFailsAtomicallyAndSupportsProviderConfiguration(t *testing.T) {
	unsupported, err := Bundle(input("messaging.aws.sqs", map[string]any{}))
	if err != nil || len(unsupported.Files) != 0 || len(unsupported.Unsupported) != 1 || unsupported.Unsupported[0].Status != "unsupported" {
		t.Fatalf("missing structured unsupported result: %+v %v", unsupported, err)
	}
	for _, provider := range []string{"azure", "gcp"} {
		m := input("storage.aws.s3", map[string]any{"bucket": "example"})
		m.Provider = provider
		out, err := Bundle(m)
		if err == nil && (len(out.Files) != 0 || len(out.Unsupported) != 1) {
			t.Fatal("partial unsupported output")
		}
	}
	for _, p := range []string{"aws", "azure", "gcp"} {
		config, err := ProviderConfig(p)
		if err != nil || !strings.Contains(config, "backend") || strings.Contains(config, "access_key") {
			t.Fatal("provider configuration", p)
		}
	}
	if _, err := ProviderConfig("other"); err == nil {
		t.Fatal("unsupported provider accepted")
	}
	if out, err := Bundle(input("storage.aws.s3", map[string]any{"name": "one", "bucket": "two"})); err == nil || len(out.Files) != 0 {
		t.Fatal("ambiguous cloud name accepted")
	}
}
