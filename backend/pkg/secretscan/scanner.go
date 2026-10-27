// Package secretscan detects credentials in generated artifacts and execution
// output (BE-D06, PRD §19). Findings identify where a secret is and what kind
// it is, never the secret itself, so they are safe to return, log and audit.
package secretscan

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// Detector names reported on findings.
const (
	DetectorRegex   = "regex"
	DetectorKeyword = "keyword"
	DetectorBase64  = "base64"
	DetectorEntropy = "entropy"
)

// Finding locates one detected secret. It deliberately has no field that can
// carry the matched value.
type Finding struct {
	Type     string `json:"type"`
	Location string `json:"location"`
	Detector string `json:"detector"`
	Line     int    `json:"line,omitempty"`
	Column   int    `json:"column,omitempty"`
}

// File is one named artifact file, e.g. a rendered Terraform file.
type File struct {
	Path    string
	Content string
}

type rule struct {
	typ   string
	re    *regexp.Regexp
	group int // submatch holding the secret; 0 is the whole match
}

// Specific credential formats, in priority order.
var rules = []rule{
	{"private_key", regexp.MustCompile(`(?s)-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----|$)`), 0},
	{"aws_access_key_id", regexp.MustCompile(`\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b`), 0},
	{"aws_secret_access_key", regexp.MustCompile(`(?i)aws[a-z0-9_.\-]{0,20}(?:secret|sk)[a-z0-9_.\-]{0,20}["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b`), 1},
	{"azure_subscription_key", regexp.MustCompile(`(?i)(?:ocp-apim-subscription-key|subscription[_-]?key)["']?\s*[:=]\s*["']?([a-f0-9]{32})\b`), 1},
	{"azure_subscription_key", regexp.MustCompile(`(?i)(?:AccountKey|SharedAccessKey)=([A-Za-z0-9+/]{40,}={0,2})`), 1},
	{"azure_subscription_key", regexp.MustCompile(`[?&]sig=([A-Za-z0-9%+/=]{30,})`), 1},
	{"gcp_service_account_key", regexp.MustCompile(`"type"\s*:\s*"service_account"`), 0},
	{"gcp_service_account_key", regexp.MustCompile(`"private_key_id"\s*:\s*"([a-f0-9]{40})"`), 1},
	{"api_key", regexp.MustCompile(`\bAIza[0-9A-Za-z_\-]{35}\b`), 0},
	{"jwt", regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}`), 0},
	{"connection_string", regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.\-]{1,30}://[^\s:/@'"]+:([^\s@'"/]+)@[^\s'"]+`), 1},
	{"api_key", regexp.MustCompile(`\b(?:sk_live_[0-9A-Za-z]{16,}|rk_live_[0-9A-Za-z]{16,}|ghp_[0-9A-Za-z]{36}|gho_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,}|glpat-[0-9A-Za-z_\-]{20}|xox[abprs]-[0-9A-Za-z\-]{10,}|sk-ant-[0-9A-Za-z_\-]{20,}|sk-proj-[0-9A-Za-z_\-]{20,}|SG\.[0-9A-Za-z_\-]{22}\.[0-9A-Za-z_\-]{43})\b`), 0},
	{"token", regexp.MustCompile(`(?i)\bbearer\s+([A-Za-z0-9._~+/=\-]{16,})`), 1},
}

// keywordRule finds literal values assigned to secret-like keys in HCL,
// JSON, YAML, env and log formats.
var keywordRule = regexp.MustCompile(`(?i)([a-z0-9_.\-]*(?:password|passwd|pwd|secret|token|api[_\-]?key|apikey|access[_\-]?key|private[_\-]?key|subscription[_\-]?key|credential)s?[a-z0-9_.\-]*)["']?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"',;}\]]+))`)

var (
	sensitiveKey    = regexp.MustCompile(`(?i)password|passwd|pwd|secret|token|api[_\-]?key|apikey|access[_\-]?key|private[_\-]?key|subscription[_\-]?key|credential`)
	harmlessKey     = regexp.MustCompile(`(?i)(?:^|[_\-.])(?:name|id|arn|ttl|length|version|path|file|type|policy|url|uri|endpoint|enabled|count|rotation|days|expiry|expiration|format|mode|ref|reference|tokens|limit|field|description|source|confidence)$|^(?:manage|enable|require|create|use)[_\-]`)
	traversal       = regexp.MustCompile(`^(?:var|local|data|module|each|count|self|path|random_password|random_string|aws_[a-z0-9_]+|azurerm_[a-z0-9_]+|google_[a-z0-9_]+)\.[A-Za-z0-9_.\[\]"\-]+$`)
	tokenRe         = regexp.MustCompile(`[A-Za-z0-9+/=_\-]{20,}`)
	base64Token     = regexp.MustCompile(`[A-Za-z0-9+/]{24,}={0,2}`)
	hexOnly         = regexp.MustCompile(`^[0-9a-fA-F\-]+$`)
	referencePrefix = []string{"${", "{{", "$(", "<", "vault:", "secret://", "arn:aws:secretsmanager:", "arn:aws:ssm:", "projects/", "http://", "https://", "[redacted", "***", "env:", "ref+"}
)

// span is a half-open byte range of content holding a secret.
type span struct {
	start, end int
	typ, det   string
}

// detect returns non-overlapping secret spans, preferring specific formats over
// keyword, base64 and entropy heuristics.
func detect(content string, nested bool) []span {
	var found []span
	add := func(s span) {
		for _, f := range found {
			if s.start < f.end && f.start < s.end {
				return
			}
		}
		found = append(found, s)
	}
	for _, r := range rules {
		for _, m := range r.re.FindAllStringSubmatchIndex(content, -1) {
			start, end := m[2*r.group], m[2*r.group+1]
			if start < 0 || (r.typ == "connection_string" && !Literal(content[start:end])) {
				continue
			}
			add(span{start, end, r.typ, DetectorRegex})
		}
	}
	for _, m := range keywordRule.FindAllStringSubmatchIndex(content, -1) {
		key := content[m[2]:m[3]]
		for g := 2; g <= 4; g++ {
			start, end := m[2*g], m[2*g+1]
			if start >= 0 {
				if SensitiveKey(key) && Literal(content[start:end]) {
					add(span{start, end, keyType(key), DetectorKeyword})
				}
				break
			}
		}
	}
	if nested {
		return found
	}
	for _, m := range base64Token.FindAllStringIndex(content, -1) {
		if inner := decodedSecret(content[m[0]:m[1]]); inner != "" {
			add(span{m[0], m[1], inner, DetectorBase64})
		}
	}
	for _, m := range tokenRe.FindAllStringIndex(content, -1) {
		if highEntropy(content[m[0]:m[1]]) {
			add(span{m[0], m[1], "high_entropy_string", DetectorEntropy})
		}
	}
	sort.Slice(found, func(i, j int) bool { return found[i].start < found[j].start })
	return found
}

// SensitiveKey reports whether a field name usually holds a credential.
func SensitiveKey(key string) bool {
	return sensitiveKey.MatchString(key) && !harmlessKey.MatchString(key)
}

// Literal reports whether value is an inline credential rather than a
// reference, placeholder, flag or number.
func Literal(value string) bool {
	v := strings.TrimSpace(value)
	lower := strings.ToLower(v)
	if len(v) < 6 || traversal.MatchString(v) || strings.HasPrefix(v, "$") {
		return false
	}
	switch lower {
	case "true", "false", "null", "none", "nil", "required", "optional", "disabled", "enabled", "redacted", "sensitive":
		return false
	}
	if _, err := strconv.ParseFloat(v, 64); err == nil {
		return false
	}
	for _, p := range referencePrefix {
		if strings.HasPrefix(lower, p) {
			return false
		}
	}
	return strings.Trim(lower, "x*.-_") != ""
}

func keyType(key string) string {
	k := strings.ToLower(key)
	switch {
	case strings.Contains(k, "aws") && strings.Contains(k, "secret"), strings.Contains(k, "secret_access_key"):
		return "aws_secret_access_key"
	case strings.Contains(k, "subscription"):
		return "azure_subscription_key"
	case strings.Contains(k, "private"):
		return "private_key"
	case strings.Contains(k, "api") || strings.Contains(k, "access"):
		return "api_key"
	case strings.Contains(k, "token"):
		return "token"
	case strings.Contains(k, "secret") || strings.Contains(k, "credential"):
		return "secret"
	}
	return "password"
}

// decodedSecret rescans printable base64 payloads once for known formats.
func decodedSecret(token string) string {
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding} {
		raw, err := enc.DecodeString(token)
		if err != nil || !printable(raw) {
			continue
		}
		if inner := detect(string(raw), true); len(inner) > 0 {
			return inner[0].typ
		}
	}
	return ""
}

func printable(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	n := 0
	for _, r := range string(b) {
		if unicode.IsPrint(r) || r == '\n' || r == '\r' || r == '\t' {
			n++
		}
	}
	return n*10 >= len([]rune(string(b)))*9
}

// highEntropy flags random-looking standalone tokens. Hex digests and UUIDs
// (artifact hashes, IDs) are skipped: their alphabet caps entropy at 4 bits.
func highEntropy(token string) bool {
	if len(token) < 32 || hexOnly.MatchString(token) {
		return false
	}
	var upper, lower, digit bool
	for _, r := range token {
		upper = upper || unicode.IsUpper(r)
		lower = lower || unicode.IsLower(r)
		digit = digit || unicode.IsDigit(r)
	}
	return upper && lower && digit && entropy(token) >= 4.3
}

func entropy(s string) float64 {
	counts := map[rune]int{}
	for _, r := range s {
		counts[r]++
	}
	var h float64
	n := float64(len([]rune(s)))
	for _, c := range counts {
		p := float64(c) / n
		h -= p * math.Log2(p)
	}
	return h
}

// ScanText scans one text artifact. Locations are name:line:column.
func ScanText(name, content string) []Finding {
	var out []Finding
	for _, s := range detect(content, false) {
		line := strings.Count(content[:s.start], "\n") + 1
		col := s.start - strings.LastIndex(content[:s.start], "\n")
		out = append(out, Finding{Type: s.typ, Location: fmt.Sprintf("%s:%d:%d", name, line, col), Detector: s.det, Line: line, Column: col})
	}
	return normalize(out)
}

// ScanFiles scans every file of a generated bundle.
func ScanFiles(files []File) []Finding {
	var out []Finding
	for _, f := range files {
		out = append(out, ScanText(f.Path, f.Content)...)
	}
	return normalize(out)
}

// ScanJSON scans each string value of a JSON document, using its key as
// context. Locations are name:<JSON pointer>.
func ScanJSON(name string, data []byte) ([]Finding, error) {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var doc any
	if err := d.Decode(&doc); err != nil {
		return nil, err
	}
	var out []Finding
	var walk func(pointer, key string, v any)
	walk = func(pointer, key string, v any) {
		switch t := v.(type) {
		case map[string]any:
			if t["type"] == "service_account" && t["private_key"] != nil {
				out = append(out, Finding{Type: "gcp_service_account_key", Location: name + ":" + pointer, Detector: DetectorRegex})
			}
			for k, child := range t {
				walk(pointer+"/"+escapePointer(k), k, child)
			}
		case []any:
			for i, child := range t {
				walk(pointer+"/"+strconv.Itoa(i), key, child)
			}
		case string:
			location := name + ":" + pointer
			if pointer == "" {
				location = name + ":/"
			}
			if SensitiveKey(key) && Literal(t) {
				out = append(out, Finding{Type: keyType(key), Location: location, Detector: DetectorKeyword})
				return
			}
			for _, s := range detect(t, false) {
				out = append(out, Finding{Type: s.typ, Location: location, Detector: s.det})
			}
		}
	}
	walk("", "", doc)
	return normalize(out), nil
}

func escapePointer(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

func normalize(in []Finding) []Finding {
	sort.SliceStable(in, func(i, j int) bool {
		if in[i].Location != in[j].Location {
			return in[i].Location < in[j].Location
		}
		return in[i].Type < in[j].Type
	})
	out := []Finding{}
	for i, f := range in {
		if i > 0 && f == in[i-1] {
			continue
		}
		out = append(out, f)
	}
	return out
}

// BlockedError reports an artifact refused because it contains secrets.
type BlockedError struct {
	Kind     string
	Findings []Finding
}

func (e *BlockedError) Error() string {
	return fmt.Sprintf("%s artifact contains %d potential secret(s)", e.Kind, len(e.Findings))
}

// Response is the uniform 422 body for blocked artifacts.
type Response struct {
	Error    string    `json:"error"`
	Message  string    `json:"message"`
	Findings []Finding `json:"findings"`
}

// Body renders the error as a client-safe response body.
func (e *BlockedError) Body() Response {
	return Response{Error: "secret_detected", Message: Message(e.Kind), Findings: e.Findings}
}

// Message is the client-facing explanation for a blocked artifact.
func Message(kind string) string {
	return "Potential secrets detected in " + kind + "; use a secret reference instead of an inline value"
}

// Check returns a *BlockedError when findings is non-empty.
func Check(kind string, findings []Finding) error {
	if len(findings) == 0 {
		return nil
	}
	return &BlockedError{Kind: kind, Findings: findings}
}
