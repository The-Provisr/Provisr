// Package terraform renders reviewed templates; it never runs Terraform or writes artifacts.
package terraform

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"net/netip"
	"sort"
	"strings"
	"text/template"

	"github.com/provisr/backend/internal/manifest"
)

//go:embed templates/*/aws/*.hcl
var assets embed.FS

// File is a deterministic artifact candidate, not a persisted or executable artifact.
type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// Unsupported identifies requests outside the reviewed AWS phase-one catalog.
type Unsupported struct {
	LogicalName string `json:"logical_name"`
	Type        string `json:"type"`
	Status      string `json:"status"`
}

// Result is all-or-nothing: unsupported resources never yield a partial deployment.
type Result struct {
	Files       []File        `json:"files"`
	Unsupported []Unsupported `json:"unsupported"`
}

type spec struct {
	path, terraformType string
	fields              []string
}

var catalog = map[string]spec{
	"compute.aws.instance":       {"compute/aws/ec2.hcl", "aws_instance", []string{"ami", "instance_type", "subnet_id"}},
	"storage.aws.s3":             {"storage/aws/s3.hcl", "aws_s3_bucket", []string{"bucket", "versioning"}},
	"database.aws.rds":           {"database/aws/rds.hcl", "aws_db_instance", []string{"identifier", "engine", "engine_version", "instance_class", "allocated_storage", "master_username", "db_subnet_group_name", "vpc_security_group_ids"}},
	"network.aws.vpc":            {"networking/aws/vpc.hcl", "aws_vpc", []string{"cidr_block"}},
	"network.aws.subnet":         {"networking/aws/subnet.hcl", "aws_subnet", []string{"vpc_id", "cidr_block", "availability_zone"}},
	"network.aws.security_group": {"networking/aws/security_group.hcl", "aws_security_group", []string{"vpc_id", "description"}},
}

// SupportedDomains reports only domains with phase-one templates for this provider.
func SupportedDomains(provider string) []string {
	if strings.ToLower(strings.TrimSpace(provider)) != "aws" {
		return []string{}
	}
	return []string{"compute", "database", "network", "storage"}
}

// Render validates typed inputs, then renders stable files without executing or persisting them.
func Render(m *manifest.Manifest) (Result, error) {
	return render(m, false)
}

func render(m *manifest.Manifest, parameterized bool) (Result, error) {
	out := Result{Files: []File{}, Unsupported: []Unsupported{}}
	validation, err := manifest.NewValidator().Validate(m)
	if err != nil || !validation.Valid {
		return out, fmt.Errorf("manifest schema validation failed")
	}
	if len(m.Unknowns) > 0 {
		return out, fmt.Errorf("resolve manifest unknowns before rendering")
	}
	resources := append([]manifest.Resource(nil), m.Resources...)
	for index := range resources {
		r := &resources[index]
		if r.LogicalName != strings.TrimSpace(r.LogicalName) {
			return out, fmt.Errorf("resource logical_name must not contain surrounding whitespace")
		}
		r.Type = strings.TrimSpace(r.Type)
		if _, ok := catalog[r.Type]; !ok || strings.ToLower(strings.TrimSpace(m.Provider)) != "aws" {
			out.Unsupported = append(out.Unsupported, Unsupported{r.LogicalName, r.Type, "unsupported"})
		}
	}
	if len(out.Unsupported) > 0 {
		return out, nil
	}
	sort.Slice(resources, func(i, j int) bool { return resources[i].LogicalName < resources[j].LogicalName })
	files := []File{{"providers.tf", "terraform {\n  required_providers {\n    aws = { source = \"hashicorp/aws\", version = \"~> 5.0\" }\n  }\n}\nprovider \"aws\" {\n  region = " + hcl(strings.TrimSpace(m.Region)) + "\n}\n"}}
	for _, r := range resources {
		s := catalog[r.Type]
		p, err := properties(r, s)
		if err != nil {
			return out, err
		}
		if parameterized {
			for key, value := range p {
				// Template branch choices (such as versioning) remain fixed to
				// the confirmed manifest; scalar/list values use module inputs.
				if _, boolean := value.(bool); !boolean {
					p[key] = expression("var.r_" + r.LogicalName + "[" + hcl(key) + "]")
				}
			}
		}
		tags := map[string]string{}
		for k, v := range m.Tags {
			tags[k] = v
		}
		for k, v := range r.Tags {
			tags[k] = v
		}
		deps := make([]string, 0, len(r.DependsOn))
		for _, name := range r.DependsOn {
			for _, dep := range resources {
				if dep.LogicalName == name {
					deps = append(deps, catalog[dep.Type].terraformType+".r_"+name)
				}
			}
		}
		sort.Strings(deps)
		data := map[string]any{"Name": "r_" + r.LogicalName, "P": p, "Tags": tags, "Dependencies": strings.Join(deps, ", ")}
		raw, err := assets.ReadFile("templates/" + s.path)
		if err != nil {
			return out, fmt.Errorf("template unavailable")
		}
		t, err := template.New(s.path).Option("missingkey=error").Funcs(template.FuncMap{"hcl": hcl}).Parse(string(raw))
		if err != nil {
			return out, fmt.Errorf("invalid internal template")
		}
		var buf bytes.Buffer
		if err := t.Execute(&buf, data); err != nil {
			return out, fmt.Errorf("template rendering failed")
		}
		files = append(files, File{"resource_" + r.LogicalName + ".tf", buf.String()})
	}
	out.Files = files
	return out, nil
}

type expression string

// hcl encodes data as HCL-compatible JSON while disabling Terraform interpolation.
func hcl(value any) string {
	if expr, ok := value.(expression); ok {
		return string(expr)
	}
	encoded, _ := json.Marshal(value) // all callers use validated JSON-compatible values
	s := strings.ReplaceAll(string(encoded), "${", "$${")
	return strings.ReplaceAll(s, "%{", "%%{")
}

func properties(r manifest.Resource, s spec) (map[string]any, error) {
	p := make(map[string]any, len(r.Properties))
	allowed := map[string]bool{}
	for _, field := range s.fields {
		allowed[field] = true
	}
	for key, value := range r.Properties {
		if !allowed[key] {
			return nil, fmt.Errorf("resource %s: unsupported property %s", r.LogicalName, key)
		}
		p[key] = value
	}
	for _, key := range s.fields {
		if key == "versioning" {
			if p[key] == nil {
				p[key] = true
			}
			if _, ok := p[key].(bool); !ok {
				return nil, fmt.Errorf("resource %s: versioning must be boolean", r.LogicalName)
			}
			continue
		}
		if key == "allocated_storage" {
			v := p[key]
			encoded, err := json.Marshal(v)
			var n float64
			if err != nil || json.Unmarshal(encoded, &n) != nil || n < 20 || n > 16384 || n != float64(int64(n)) {
				return nil, fmt.Errorf("resource %s: allocated_storage must be an integer between 20 and 16384", r.LogicalName)
			}
			continue
		}
		if key == "vpc_security_group_ids" {
			encoded, err := json.Marshal(p[key])
			var ids []string
			if err != nil || json.Unmarshal(encoded, &ids) != nil || len(ids) == 0 {
				return nil, fmt.Errorf("resource %s: vpc_security_group_ids is required", r.LogicalName)
			}
			for _, id := range ids {
				if strings.TrimSpace(id) == "" {
					return nil, fmt.Errorf("resource %s: empty security group ID", r.LogicalName)
				}
			}
			p[key] = ids
			continue
		}
		value, ok := p[key].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("resource %s: %s is required", r.LogicalName, key)
		}
		if key == "cidr_block" {
			prefix, err := netip.ParsePrefix(value)
			if err != nil || !prefix.Addr().Is4() || prefix != prefix.Masked() {
				return nil, fmt.Errorf("resource %s: cidr_block must be a canonical IPv4 prefix", r.LogicalName)
			}
		}
		if key == "engine" && value != "postgres" && value != "mysql" {
			return nil, fmt.Errorf("resource %s: unsupported database engine", r.LogicalName)
		}
	}
	if r.SecuritySettings != nil && strings.TrimSpace(r.SecuritySettings.EncryptionType) != "" {
		return nil, fmt.Errorf("resource %s: encryption type overrides are unsupported in phase one", r.LogicalName)
	}
	if r.SecuritySettings != nil && (r.SecuritySettings.PublicAccess ||
		(!strings.HasPrefix(r.Type, "network.") && !r.SecuritySettings.EncryptionEnabled)) {
		return nil, fmt.Errorf("resource %s: phase-one templates require private encrypted resources", r.LogicalName)
	}
	return p, nil
}
