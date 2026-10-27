package secretscan

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// Fixtures are assembled at runtime so the repository never contains
// strings that themselves look like live credentials.
var (
	awsKey    = "AKIA" + "IOSFODNN7" + "EXAMPLE"
	awsSecret = "wJalrXUtnFEMI/K7MDENG/" + "bPxRfiCYEXAMPLEKEY"
	jwt       = "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" + ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
	pemKey    = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\nabc\n-----END RSA " + "PRIVATE KEY-----"
	gcpKey    = "AIza" + "SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY"
	ghToken   = "ghp_" + "16C7e42F292c6912E7710c838347Ae178B4a"
	random    = "q8Zr2Lx9Vb4Nc7Mw1Kt6Hy3Pd0Sg5Jf8Ua2Ee"
)

func TestScanTextDetectsEachType(t *testing.T) {
	cases := []struct {
		name, content, typ, secret string
	}{
		{"aws access key", `access = "` + awsKey + `"`, "aws_access_key_id", awsKey},
		{"aws secret key", `aws_secret_access_key = "` + awsSecret + `"`, "aws_secret_access_key", awsSecret},
		{"azure subscription key", "Ocp-Apim-Subscription-Key: 0123456789abcdef0123456789abcdef", "azure_subscription_key", "0123456789abcdef0123456789abcdef"},
		{"azure account key", "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=" + strings.Repeat("Ab1+", 22) + "==;", "azure_subscription_key", strings.Repeat("Ab1+", 22)},
		{"gcp service account", `{"type": "service_account", "project_id": "p"}`, "gcp_service_account_key", `"type": "service_account"`},
		{"gcp api key", "key=" + gcpKey, "api_key", gcpKey},
		{"private key", pemKey, "private_key", "MIIEowIBAAKCAQEAtest"},
		{"jwt", "Authorization header " + jwt, "jwt", jwt},
		{"connection string", "url = postgres://admin:S3cr3tPass@db.internal:5432/app", "connection_string", "S3cr3tPass"},
		{"vendor api key", "GITHUB=" + ghToken, "api_key", ghToken},
		{"generic password", `password = "hunter22!"`, "password", "hunter22!"},
		{"json password", `{"master_password":"Sup3rS3cret"}`, "password", "Sup3rS3cret"},
		{"yaml token", "auth_token: abcdef123456", "token", "abcdef123456"},
		{"base64 credential", "blob " + base64.StdEncoding.EncodeToString([]byte("aws key "+awsKey)), "aws_access_key_id", base64.StdEncoding.EncodeToString([]byte("aws key " + awsKey))},
		{"high entropy", "value " + random, "high_entropy_string", random},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			findings := ScanText("main.tf", tc.content)
			if len(findings) == 0 || findings[0].Type != tc.typ {
				t.Fatalf("got %+v, want %s", findings, tc.typ)
			}
			raw, _ := json.Marshal(findings)
			if strings.Contains(string(raw), tc.secret) {
				t.Fatalf("finding leaks secret: %s", raw)
			}
			redacted, _ := Redact("log", tc.content)
			if strings.Contains(redacted, tc.secret) || !strings.Contains(redacted, "[REDACTED:") {
				t.Fatalf("redaction leaked or missed: %q", redacted)
			}
		})
	}
}

func TestScanTextIgnoresReferencesAndIdentifiers(t *testing.T) {
	for _, content := range []string{
		`password = var.db_password`,
		`password = random_password.db.result`,
		`master_password = "${var.db_password}"`,
		`secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:db"`,
		`password_secret_name = "app-db-credentials"`,
		`manage_master_user_password = true`,
		`http_tokens = "required"`,
		`hash = "` + strings.Repeat("ab12", 16) + `"`,
		`id = "3fa85f64-5717-4562-b3fc-2c963f66afa6"`,
		`ami = "ami-0abcdef1234567890"`,
		`password: <set-in-vault>`,
		`token = "${TOKEN}"`,
		`url = https://example.com/path`,
	} {
		if findings := ScanText("main.tf", content); len(findings) != 0 {
			t.Errorf("false positive for %q: %+v", content, findings)
		}
	}
}

func TestScanTextLocations(t *testing.T) {
	findings := ScanText("resources/compute.tf", "a = 1\n  key = \""+awsKey+"\"\n")
	if len(findings) != 1 || findings[0].Location != "resources/compute.tf:2:10" || findings[0].Line != 2 || findings[0].Column != 10 {
		t.Fatalf("location %+v", findings)
	}
}

func TestScanJSONReportsPointers(t *testing.T) {
	doc := `{"resources":[{"logical_name":"db","properties":{"identifier":"app-db","master_password":"Sup3rS3cret!"}},
	{"logical_name":"app","properties":{"user_data":"export AWS_ACCESS_KEY_ID=` + awsKey + `"}}],
	"metadata":{"sa":{"type":"service_account","private_key":"x"}},"hash":"` + strings.Repeat("0f", 32) + `"}`
	findings, err := ScanJSON("manifest", []byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"manifest:/resources/0/properties/master_password": "password",
		"manifest:/resources/1/properties/user_data":       "aws_access_key_id",
		"manifest:/metadata/sa":                            "gcp_service_account_key",
	}
	if len(findings) != len(want) {
		t.Fatalf("findings %+v", findings)
	}
	for _, f := range findings {
		if want[f.Location] != f.Type {
			t.Fatalf("unexpected finding %+v", f)
		}
	}
	if _, err := ScanJSON("manifest", []byte("{")); err == nil {
		t.Fatal("invalid JSON accepted")
	}
}

func TestScanFilesAndBlockedError(t *testing.T) {
	findings := ScanFiles([]File{{"main.tf", "provider \"aws\" {}\n"}, {"terraform.tfvars", `r_db = {"password":"hunter22!"}`}})
	if len(findings) != 1 || !strings.HasPrefix(findings[0].Location, "terraform.tfvars:1:") {
		t.Fatalf("findings %+v", findings)
	}
	if Check("terraform", nil) != nil {
		t.Fatal("empty findings blocked")
	}
	err := Check("terraform", findings)
	blocked, ok := err.(*BlockedError)
	if !ok || blocked.Body().Error != "secret_detected" || len(blocked.Body().Findings) != 1 {
		t.Fatalf("blocked error %v", err)
	}
}

func FuzzFindingsNeverContainSecret(f *testing.F) {
	f.Add("hunter22!xyz")
	f.Add("Sup3rS3cretValue")
	f.Fuzz(func(t *testing.T, secret string) {
		if len(secret) < 8 || strings.ContainsAny(secret, "\"'\n\\") {
			return
		}
		content := `password = "` + secret + `"`
		findings := ScanText("main.tf", content)
		raw, _ := json.Marshal(findings)
		for _, f := range findings {
			if strings.Contains(f.Location, secret) || strings.Contains(f.Type, secret) {
				t.Fatalf("finding leaks secret: %s", raw)
			}
		}
	})
}
