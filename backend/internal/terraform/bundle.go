package terraform

import (
	"fmt"
	"sort"
	"strings"

	"github.com/provisr/backend/internal/manifest"
)

// Bundle packages reviewed resources into a loaded local module. Nested .tf
// files alone would be ignored by Terraform's root module loader.
func Bundle(m *manifest.Manifest) (Result, error) {
	// MCP-012's canonical projection preserves an S3 cloud name as `name`.
	// Translate only this lossless alias; never infer AMIs, subnets or DB engines.
	if m != nil {
		copyManifest := *m
		copyManifest.Resources = append([]manifest.Resource(nil), m.Resources...)
		for i, r := range copyManifest.Resources {
			if r.Type != "storage.aws.s3" || r.Properties["name"] == nil {
				continue
			}
			props := map[string]any{}
			for key, value := range r.Properties {
				props[key] = value
			}
			name, ok := props["name"].(string)
			if !ok {
				return Result{}, fmt.Errorf("invalid S3 cloud name")
			}
			if bucket, exists := props["bucket"]; exists && bucket != name {
				return Result{}, fmt.Errorf("conflicting S3 cloud names")
			}
			props["bucket"] = name
			delete(props, "name")
			copyManifest.Resources[i].Properties = props
		}
		m = &copyManifest
	}
	rendered, err := render(m, true)
	if err != nil || len(rendered.Unsupported) != 0 {
		return rendered, err
	}
	main, err := ProviderConfig(m.Provider)
	if err != nil {
		return Result{}, err
	}
	main += "module \"resources\" {\n  source = \"./resources\"\n"
	variables := "variable \"region\" {\n  type = string\n}\n"
	childVariables := ""
	values := "region = " + hcl(strings.TrimSpace(m.Region)) + "\n"
	files := []File{{"outputs.tf", "output \"resource_ids\" {\n  value = module.resources.resource_ids\n}\n"}}
	domains := map[string]string{}
	outputs := "output \"resource_ids\" {\n  value = {\n"
	resources := append([]manifest.Resource(nil), m.Resources...)
	sort.Slice(resources, func(i, j int) bool { return resources[i].LogicalName < resources[j].LogicalName })
	for _, r := range resources {
		s := catalog[strings.TrimSpace(r.Type)]
		props, err := properties(r, s)
		if err != nil {
			return Result{}, err
		}
		variable := "r_" + r.LogicalName
		declaration := fmt.Sprintf("variable %s {\n  type = any\n}\n", hcl(variable))
		variables += declaration
		childVariables += declaration
		values += variable + " = " + hcl(props) + "\n"
		main += "  " + variable + " = var." + variable + "\n"
		domain := strings.Split(s.path, "/")[0]
		for _, file := range rendered.Files {
			if file.Path == "resource_"+r.LogicalName+".tf" {
				domains[domain] += file.Content + "\n"
			}
		}
		outputs += fmt.Sprintf("    %s = %s.r_%s.id\n", hcl(r.LogicalName), s.terraformType, r.LogicalName)
	}
	files = append(files, File{"main.tf", main + "}\n"}, File{"variables.tf", variables},
		File{"terraform.tfvars", values}, File{"resources/variables.tf", childVariables})
	for domain, content := range domains {
		files = append(files, File{"resources/" + domain + ".tf", content})
	}
	files = append(files, File{"resources/outputs.tf", outputs + "  }\n}\n"})
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return Result{Files: files, Unsupported: []Unsupported{}}, nil
}

// ProviderConfig returns credential-free partial backend configuration.
// BE-D08 supplies the controlled backend settings at init; no local state fallback.
// Multi-cloud resource templates remain subject to the reviewed catalog.
func ProviderConfig(provider string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "aws":
		return "terraform {\n  required_providers {\n    aws = { source = \"hashicorp/aws\", version = \"~> 5.0\" }\n  }\n  backend \"s3\" {}\n}\nprovider \"aws\" {\n  region = var.region\n}\n", nil
	case "azure":
		return "terraform {\n  required_providers {\n    azurerm = { source = \"hashicorp/azurerm\", version = \"~> 4.0\" }\n  }\n  backend \"azurerm\" {}\n}\nprovider \"azurerm\" {\n  features {}\n}\n", nil
	case "gcp":
		return "terraform {\n  required_providers {\n    google = { source = \"hashicorp/google\", version = \"~> 6.0\" }\n  }\n  backend \"gcs\" {}\n}\nprovider \"google\" {\n  region = var.region\n}\n", nil
	default:
		return "", fmt.Errorf("unsupported provider")
	}
}
