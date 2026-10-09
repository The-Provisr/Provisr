package manifest

// SourceType represents the origin of manifest attributes or values.
type SourceType string

const (
	SourceUserPrompt     SourceType = "user_prompt"
	SourcePolicyDefault  SourceType = "policy_default"
	SourceCloudState     SourceType = "cloud_state"
	SourceAIAssumption   SourceType = "ai_assumption"
	SourceImageDetection SourceType = "image_detection"
	SourceAdminDefault   SourceType = "admin_default"
)

// ValidSourceTypes lists accepted source values.
var ValidSourceTypes = map[SourceType]bool{
	SourceUserPrompt:     true,
	SourcePolicyDefault:  true,
	SourceCloudState:     true,
	SourceAIAssumption:   true,
	SourceImageDetection: true,
	SourceAdminDefault:   true,
}

// SourceMetadata provides lineage and confidence for an inferred value or resource.
type SourceMetadata struct {
	Source     SourceType `json:"source"`
	Confidence float64    `json:"confidence"` // 0.0 to 1.0
}

// SecuritySettings specifies baseline security posture.
type SecuritySettings struct {
	PublicAccess      bool   `json:"public_access,omitempty"`
	EncryptionEnabled bool   `json:"encryption_enabled,omitempty"`
	EncryptionType    string `json:"encryption_type,omitempty"`
}

// CostEstimate specifies expected cost parameters.
type CostEstimate struct {
	EstimatedMonthlyUSD float64 `json:"estimated_monthly_usd,omitempty"`
	ConfidencePct       int     `json:"confidence_pct,omitempty"`
}

// Unknown represents an unresolved field or open question.
type Unknown struct {
	Field          string `json:"field"`
	Description    string `json:"description"`
	SuggestedValue string `json:"suggested_value,omitempty"`
}

// Resource represents a single cloud infrastructure resource in the manifest.
type Resource struct {
	LogicalName      string            `json:"logical_name"`
	Type             string            `json:"type"` // format: {domain}.{provider}.{kind}
	Properties       map[string]any    `json:"properties,omitempty"`
	DependsOn        []string          `json:"depends_on,omitempty"`
	Tags             map[string]string `json:"tags,omitempty"`
	SecuritySettings *SecuritySettings `json:"security_settings,omitempty"`
	Source           *SourceMetadata   `json:"source,omitempty"`
}

// Manifest represents the canonical provider-neutral infrastructure intent per PRD §13.
type Manifest struct {
	SchemaVersion  string            `json:"schema_version"`
	Provider       string            `json:"provider"`
	Region         string            `json:"region"`
	CloudAccountID string            `json:"cloud_account_id,omitempty"`
	Environment    string            `json:"environment,omitempty"`
	Metadata       map[string]any    `json:"metadata,omitempty"`
	Resources      []Resource        `json:"resources"`
	Assumptions    []string          `json:"assumptions,omitempty"`
	Unknowns       []Unknown         `json:"unknowns,omitempty"`
	CostEstimate   *CostEstimate     `json:"cost_estimate,omitempty"`
	Tags           map[string]string `json:"tags,omitempty"`
}

// ValidationError describes a specific schema validation defect.
type ValidationError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ValidationResult summarizes the outcome of manifest validation.
type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors,omitempty"`
}
