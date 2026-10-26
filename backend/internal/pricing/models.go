package pricing

import "time"

// LookupRequest selects a provider offer. Filters contain provider-specific
// product attributes (for example AWS instanceType or Azure skuName).
type LookupRequest struct {
	Provider string            `json:"provider"`
	Service  string            `json:"service"`
	Region   string            `json:"region"`
	Tier     string            `json:"tier,omitempty"`
	Unit     string            `json:"unit,omitempty"`
	Currency string            `json:"currency,omitempty"`
	Mode     string            `json:"mode,omitempty"` // bulk or on_demand
	Filters  map[string]string `json:"filters,omitempty"`
}

// Price is the normalized provider offer consumed by MCP cost tools.
type Price struct {
	Provider      string            `json:"provider"`
	Service       string            `json:"service"`
	Region        string            `json:"region"`
	Tier          string            `json:"tier"`
	Unit          string            `json:"unit"`
	PricePerUnit  float64           `json:"price_per_unit"`
	Currency      string            `json:"currency"`
	EffectiveDate time.Time         `json:"effective_date"`
	Freshness     FreshnessMetadata `json:"freshness_metadata"`
}

type FreshnessMetadata struct {
	FetchedAt time.Time `json:"fetched_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Stale     bool      `json:"stale"`
	Warning   string    `json:"warning,omitempty"`
}

type providerOffer struct {
	Unit          string
	PricePerUnit  float64
	Currency      string
	EffectiveDate time.Time
	Tier          string
}
