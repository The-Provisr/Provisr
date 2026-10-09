package manifest

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	logicalNameRegex = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)
	regionRegex      = regexp.MustCompile(`^[a-z0-9_-]+$`)
	typePartRegex    = regexp.MustCompile(`^[a-z0-9_-]+$`)

	validProviders = map[string]bool{
		"aws":   true,
		"azure": true,
		"gcp":   true,
	}

	validDomains = map[string]bool{
		"compute":    true,
		"storage":    true,
		"database":   true,
		"network":    true,
		"security":   true,
		"monitoring": true,
		"analytics":  true,
		"messaging":  true,
		"container":  true,
	}
)

// Validator validates canonical Manifest data structures.
type Validator struct{}

// NewValidator creates a new manifest validator instance.
func NewValidator() *Validator {
	return &Validator{}
}

// Validate executes all schema, reference, and dependency checks on the manifest.
func (v *Validator) Validate(m *Manifest) (*ValidationResult, error) {
	if m == nil {
		return &ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Field: "manifest", Code: "nil_manifest", Message: "manifest must not be nil"},
			},
		}, nil
	}

	var errors []ValidationError

	// 1. Schema version check
	if strings.TrimSpace(m.SchemaVersion) == "" {
		errors = append(errors, ValidationError{
			Field:   "schema_version",
			Code:    "missing_schema_version",
			Message: "schema_version is required",
		})
	} else if !strings.HasPrefix(m.SchemaVersion, "1.") {
		errors = append(errors, ValidationError{
			Field:   "schema_version",
			Code:    "unsupported_schema_version",
			Message: fmt.Sprintf("unsupported schema version %q; only 1.x versions are supported", m.SchemaVersion),
		})
	}

	// 2. Provider check
	provider := strings.ToLower(strings.TrimSpace(m.Provider))
	if provider == "" {
		errors = append(errors, ValidationError{
			Field:   "provider",
			Code:    "missing_provider",
			Message: "provider is required",
		})
	} else if !validProviders[provider] {
		errors = append(errors, ValidationError{
			Field:   "provider",
			Code:    "invalid_provider",
			Message: fmt.Sprintf("unsupported provider %q; must be one of: aws, azure, gcp", m.Provider),
		})
	}

	// 3. Region check
	region := strings.TrimSpace(m.Region)
	if region == "" {
		errors = append(errors, ValidationError{
			Field:   "region",
			Code:    "missing_region",
			Message: "region is required",
		})
	} else if !regionRegex.MatchString(region) {
		errors = append(errors, ValidationError{
			Field:   "region",
			Code:    "invalid_region",
			Message: fmt.Sprintf("region %q contains invalid characters", m.Region),
		})
	}

	// 4. Resources presence
	if len(m.Resources) == 0 {
		errors = append(errors, ValidationError{
			Field:   "resources",
			Code:    "empty_resources",
			Message: "manifest must contain at least one resource",
		})
		return &ValidationResult{Valid: len(errors) == 0, Errors: errors}, nil
	}

	// 5. Individual resource validation
	resourceMap := make(map[string]bool, len(m.Resources))
	for i, res := range m.Resources {
		prefix := fmt.Sprintf("resources[%d]", i)

		// Logical name
		name := strings.TrimSpace(res.LogicalName)
		if name == "" {
			errors = append(errors, ValidationError{
				Field:   prefix + ".logical_name",
				Code:    "missing_logical_name",
				Message: "resource logical_name is required",
			})
		} else if !logicalNameRegex.MatchString(name) {
			errors = append(errors, ValidationError{
				Field:   prefix + ".logical_name",
				Code:    "invalid_logical_name",
				Message: fmt.Sprintf("logical_name %q must match pattern '^[a-z0-9_-]{1,64}$'", res.LogicalName),
			})
		} else if resourceMap[name] {
			errors = append(errors, ValidationError{
				Field:   prefix + ".logical_name",
				Code:    "duplicate_logical_name",
				Message: fmt.Sprintf("duplicate resource logical_name %q", name),
			})
		} else {
			resourceMap[name] = true
		}

		// Type format: {domain}.{provider}.{kind}
		resType := strings.TrimSpace(res.Type)
		if resType == "" {
			errors = append(errors, ValidationError{
				Field:   prefix + ".type",
				Code:    "missing_type",
				Message: "resource type is required",
			})
		} else {
			typeParts := strings.Split(resType, ".")
			if len(typeParts) != 3 {
				errors = append(errors, ValidationError{
					Field:   prefix + ".type",
					Code:    "invalid_type_format",
					Message: fmt.Sprintf("resource type %q must follow '{domain}.{provider}.{kind}' naming convention", resType),
				})
			} else {
				domain, resProvider, kind := typeParts[0], typeParts[1], typeParts[2]
				if !validDomains[domain] {
					errors = append(errors, ValidationError{
						Field:   prefix + ".type",
						Code:    "invalid_domain",
						Message: fmt.Sprintf("resource domain %q is not recognized", domain),
					})
				}
				if provider != "" && resProvider != provider {
					errors = append(errors, ValidationError{
						Field:   prefix + ".type",
						Code:    "provider_mismatch",
						Message: fmt.Sprintf("resource provider %q in type does not match manifest provider %q", resProvider, provider),
					})
				}
				if !typePartRegex.MatchString(kind) {
					errors = append(errors, ValidationError{
						Field:   prefix + ".type",
						Code:    "invalid_kind",
						Message: fmt.Sprintf("resource kind %q contains invalid characters", kind),
					})
				}
			}
		}

		// Source metadata
		if res.Source != nil {
			if !ValidSourceTypes[res.Source.Source] {
				errors = append(errors, ValidationError{
					Field:   prefix + ".source.source",
					Code:    "invalid_source_type",
					Message: fmt.Sprintf("unknown source type %q", res.Source.Source),
				})
			}
			if res.Source.Confidence < 0.0 || res.Source.Confidence > 1.0 {
				errors = append(errors, ValidationError{
					Field:   prefix + ".source.confidence",
					Code:    "invalid_confidence",
					Message: fmt.Sprintf("confidence %f must be between 0.0 and 1.0", res.Source.Confidence),
				})
			}
		}
	}

	// 6. Dependencies validation (dangling references and self-dependencies)
	for i, res := range m.Resources {
		prefix := fmt.Sprintf("resources[%d].depends_on", i)
		for _, dep := range res.DependsOn {
			if dep == res.LogicalName {
				errors = append(errors, ValidationError{
					Field:   prefix,
					Code:    "self_dependency",
					Message: fmt.Sprintf("resource %q cannot depend on itself", res.LogicalName),
				})
			} else if !resourceMap[dep] {
				errors = append(errors, ValidationError{
					Field:   prefix,
					Code:    "dangling_dependency",
					Message: fmt.Sprintf("resource %q depends on non-existent resource %q", res.LogicalName, dep),
				})
			}
		}
	}

	// 7. Circular dependency check
	if cycle := detectCycles(m.Resources); len(cycle) > 0 {
		errors = append(errors, ValidationError{
			Field:   "resources.depends_on",
			Code:    "circular_dependency",
			Message: fmt.Sprintf("circular dependency detected: %s", strings.Join(cycle, " -> ")),
		})
	}

	// 8. Cost estimate validation
	if m.CostEstimate != nil {
		if m.CostEstimate.EstimatedMonthlyUSD < 0.0 {
			errors = append(errors, ValidationError{
				Field:   "cost_estimate.estimated_monthly_usd",
				Code:    "invalid_cost",
				Message: "estimated_monthly_usd must not be negative",
			})
		}
		if m.CostEstimate.ConfidencePct < 0 || m.CostEstimate.ConfidencePct > 100 {
			errors = append(errors, ValidationError{
				Field:   "cost_estimate.confidence_pct",
				Code:    "invalid_confidence_pct",
				Message: "confidence_pct must be between 0 and 100",
			})
		}
	}

	return &ValidationResult{
		Valid:  len(errors) == 0,
		Errors: errors,
	}, nil
}

// detectCycles detects directed cycles in the resource dependency graph.
func detectCycles(resources []Resource) []string {
	adj := make(map[string][]string, len(resources))
	for _, r := range resources {
		adj[r.LogicalName] = r.DependsOn
	}

	visited := make(map[string]int, len(resources)) // 0: unvisited, 1: visiting, 2: visited
	var cycle []string

	var dfs func(node string, path []string) bool
	dfs = func(node string, path []string) bool {
		visited[node] = 1
		path = append(path, node)

		for _, dep := range adj[node] {
			if visited[dep] == 1 {
				// Cycle found: extract the cyclic segment
				startIdx := 0
				for i, p := range path {
					if p == dep {
						startIdx = i
						break
					}
				}
				cycle = append(path[startIdx:], dep)
				return true
			}
			if visited[dep] == 0 {
				if dfs(dep, path) {
					return true
				}
			}
		}

		visited[node] = 2
		return false
	}

	for _, r := range resources {
		if visited[r.LogicalName] == 0 {
			if dfs(r.LogicalName, nil) {
				return cycle
			}
		}
	}

	return nil
}
