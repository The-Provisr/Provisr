package secretscan

import (
	"strings"
	"testing"
)

func TestRedactPreservesStructure(t *testing.T) {
	in := "Plan: 1 to add\npassword = \"hunter22!\"\nkey " + awsKey + " done\n"
	out, findings := Redact("apply.log", in)
	want := "Plan: 1 to add\npassword = \"[REDACTED:password]\"\nkey [REDACTED:aws_access_key_id] done\n"
	if out != want || len(findings) != 2 {
		t.Fatalf("got %q %+v", out, findings)
	}
	if clean, findings := Redact("apply.log", "Apply complete! Resources: 1 added.\n"); clean != "Apply complete! Resources: 1 added.\n" || len(findings) != 0 {
		t.Fatal("clean output changed")
	}
}

func TestRedactingWriterStreamsSplitSecrets(t *testing.T) {
	var sink strings.Builder
	w := NewRedactingWriter(&sink, "apply.log")
	input := "line one\nkey=" + awsKey + "\n" + pemKey + "\ntail without newline " + awsKey
	// Byte-by-byte writes split every secret across calls.
	for i := 0; i < len(input); i++ {
		if _, err := w.Write([]byte{input[i]}); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(sink.String(), "MIIEowIBAAKCAQEAtest") {
			t.Fatal("private key body leaked before END marker")
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	out := sink.String()
	if strings.Contains(out, awsKey) || strings.Contains(out, "MIIEow") || !strings.HasPrefix(out, "line one\n") {
		t.Fatalf("leaked: %q", out)
	}
	if len(w.Findings()) < 3 {
		t.Fatalf("findings %+v", w.Findings())
	}
}
