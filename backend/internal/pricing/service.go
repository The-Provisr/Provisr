package pricing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrUnavailable = errors.New("pricing provider unavailable")
var ErrNotFound = errors.New("matching pricing offer not found")

type offerLookup interface {
	lookup(context.Context, LookupRequest) (providerOffer, error)
}

type cacheEntry struct {
	price     Price
	expiresAt time.Time
}

type CacheStore interface {
	Get(context.Context, string) (cacheEntry, bool, error)
	Put(context.Context, string, cacheEntry) error
}

type memoryCacheStore struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
}

func (m *memoryCacheStore) Get(_ context.Context, key string) (cacheEntry, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.entries[key]
	return entry, ok, nil
}

func (m *memoryCacheStore) Put(_ context.Context, key string, entry cacheEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[key] = entry
	return nil
}

// Service normalizes provider pricing and caches the last known offer for
// availability during transient provider failures.
type Service struct {
	providers map[string]offerLookup
	bulkTTL   time.Duration
	queryTTL  time.Duration
	now       func() time.Time
	cache     CacheStore
}

type Config struct {
	BulkTTL      time.Duration
	OnDemandTTL  time.Duration
	GoogleAPIKey string
	AWSAccessKey string
	AWSSecretKey string
	AWSSession   string
	HTTPClient   *http.Client
	Cache        CacheStore
}

func NewService(config Config) *Service {
	bulkTTL := config.BulkTTL
	if bulkTTL <= 0 {
		bulkTTL = 24 * time.Hour
	}
	queryTTL := config.OnDemandTTL
	if queryTTL <= 0 {
		queryTTL = time.Hour
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	cache := config.Cache
	if cache == nil {
		cache = &memoryCacheStore{entries: make(map[string]cacheEntry)}
	}
	return &Service{
		providers: map[string]offerLookup{
			"aws":   awsProvider{client: client, accessKey: config.AWSAccessKey, secretKey: config.AWSSecretKey, sessionToken: config.AWSSession},
			"azure": azureProvider{client: client},
			"gcp":   gcpProvider{client: client, apiKey: config.GoogleAPIKey},
		},
		bulkTTL: bulkTTL, queryTTL: queryTTL, now: time.Now, cache: cache,
	}
}

func (s *Service) Lookup(ctx context.Context, request LookupRequest) (Price, error) {
	request.Provider = strings.ToLower(strings.TrimSpace(request.Provider))
	request.Mode = strings.ToLower(strings.TrimSpace(request.Mode))
	if request.Mode == "" {
		request.Mode = "on_demand"
	}
	if request.Mode != "bulk" && request.Mode != "on_demand" {
		return Price{}, fmt.Errorf("mode must be bulk or on_demand")
	}
	if request.Provider != "aws" && request.Provider != "azure" && request.Provider != "gcp" {
		return Price{}, fmt.Errorf("unsupported pricing provider")
	}
	request.Service = strings.TrimSpace(request.Service)
	request.Region = strings.TrimSpace(request.Region)
	request.Tier = strings.TrimSpace(request.Tier)
	request.Unit = strings.TrimSpace(request.Unit)
	if request.Service == "" || request.Region == "" {
		return Price{}, fmt.Errorf("service and region are required")
	}
	if request.Tier == "" && len(request.Filters) == 0 {
		return Price{}, fmt.Errorf("tier or provider filters are required to identify a price offer")
	}
	if len(request.Service) > 128 || len(request.Region) > 64 || len(request.Tier) > 128 || len(request.Unit) > 64 {
		return Price{}, fmt.Errorf("pricing lookup field is too long")
	}
	if len(request.Filters) > 20 {
		return Price{}, fmt.Errorf("too many provider filters")
	}
	for key, value := range request.Filters {
		if len(key) == 0 || len(key) > 64 || len(value) > 256 {
			return Price{}, fmt.Errorf("invalid provider filter")
		}
	}
	request.Currency = strings.ToUpper(strings.TrimSpace(request.Currency))
	if request.Currency == "" {
		request.Currency = "USD"
	}
	if len(request.Currency) != 3 {
		return Price{}, fmt.Errorf("currency must be an ISO 4217 code")
	}
	key := cacheKey(request)
	now := s.now().UTC()

	cached, found, _ := s.cache.Get(ctx, key)
	if found && now.Before(cached.expiresAt) {
		price := cached.price
		price.Freshness.Stale = false
		price.Freshness.Warning = ""
		return price, nil
	}

	provider := s.providers[request.Provider]
	offer, err := provider.lookup(ctx, request)
	if err != nil {
		if found {
			cached.price.Freshness.Stale = true
			cached.price.Freshness.Warning = "Pricing provider was unavailable; showing the last cached price."
			return cached.price, nil
		}
		return Price{}, fmt.Errorf("%w: %s", ErrUnavailable, request.Provider)
	}
	if offer.PricePerUnit < 0 || offer.Currency == "" || offer.Unit == "" {
		return Price{}, fmt.Errorf("%w: invalid provider response", ErrUnavailable)
	}
	if offer.EffectiveDate.IsZero() {
		offer.EffectiveDate = now
	}
	ttl := s.queryTTL
	if request.Mode == "bulk" {
		ttl = s.bulkTTL
	}
	price := Price{
		Provider: request.Provider, Service: request.Service, Region: request.Region,
		Tier: firstNonEmpty(offer.Tier, request.Tier), Unit: offer.Unit,
		PricePerUnit: offer.PricePerUnit, Currency: offer.Currency,
		EffectiveDate: offer.EffectiveDate.UTC(),
		Freshness:     FreshnessMetadata{FetchedAt: now, ExpiresAt: now.Add(ttl)},
	}
	_ = s.cache.Put(ctx, key, cacheEntry{price: price, expiresAt: now.Add(ttl)})
	return price, nil
}

func cacheKey(request LookupRequest) string {
	if len(request.Filters) > 0 {
		keys := make([]string, 0, len(request.Filters))
		for key := range request.Filters {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		ordered := make(map[string]string, len(keys))
		for _, key := range keys {
			ordered[key] = request.Filters[key]
		}
		request.Filters = ordered
	}
	serialized, _ := json.Marshal(request)
	hash := sha256.Sum256(serialized)
	return hex.EncodeToString(hash[:])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "unknown"
}
