package cloudaccount

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/provisr/backend/internal/terraform"
	"github.com/provisr/backend/pkg/cloudcrypto"
)

// CapabilityAccount is internal-only; credentials/metadata never serialize to callers.
type CapabilityAccount struct {
	ID, WorkspaceID, Provider, Label, Status, RoleARN, ExternalID, DefaultRegion, AccountID string
	UpdatedAt, VerifiedAt                                                                   time.Time
}

// CapabilityStore rereads current status every request, including cache hits.
type CapabilityStore interface {
	Accounts(context.Context, string) ([]CapabilityAccount, error)
}

// ProviderDiscovery performs read-only, delegated provider checks.
type ProviderDiscovery interface {
	Discover(context.Context, CapabilityAccount) (Discovery, error)
}

// Discovery contains safe facts only, never provider credentials or unrestricted metadata.
type Discovery struct {
	AccountID           string
	Regions             []string
	PermissionsVerified bool
}

// AccountCapability is the whitelisted public contract consumed by MCP-007.
type AccountCapability struct {
	ID               string     `json:"id"`
	Provider         string     `json:"provider"`
	Status           string     `json:"status"`
	AccountAlias     string     `json:"account_alias"`
	AccountIdentity  string     `json:"account_identity"`
	DefaultRegion    string     `json:"default_region"`
	AvailableRegions []string   `json:"available_regions"`
	SupportedDomains []string   `json:"supported_domains"`
	ExecutionReady   bool       `json:"execution_ready"`
	CheckedAt        *time.Time `json:"checked_at"`
	Warning          string     `json:"warning,omitempty"`
}

// Capabilities is workspace-scoped even when no accounts are connected.
type Capabilities struct {
	WorkspaceID string              `json:"workspace_id"`
	Accounts    []AccountCapability `json:"accounts"`
}

type capabilityCache struct {
	value            Discovery
	expires, checked time.Time
}
type capabilitiesHandler struct {
	store      CapabilityStore
	provider   ProviderDiscovery
	token      string
	mu         sync.Mutex
	cache      map[string]capabilityCache
	generation map[string]uint64
	now        func() time.Time
}

// NewCapabilitiesHandler requires a trusted service token; MCP/gateway authorize the user.
// A cache hit cannot revive a disconnected account because store state is always reread.
func NewCapabilitiesHandler(store CapabilityStore, provider ProviderDiscovery, token string) http.Handler {
	return &capabilitiesHandler{store: store, provider: provider, token: token, cache: map[string]capabilityCache{}, generation: map[string]uint64{}, now: time.Now}
}

func (h *capabilitiesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.token == "" {
		http.Error(w, `{"error":"capabilities_not_configured"}`, http.StatusServiceUnavailable)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+h.token)) != 1 {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	workspace := r.PathValue("workspace_id")
	if !validWorkspaceID(workspace) {
		http.Error(w, `{"error":"invalid_workspace"}`, http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	accounts, err := h.store.Accounts(ctx, workspace)
	if err != nil {
		http.Error(w, `{"error":"capabilities_unavailable"}`, http.StatusBadGateway)
		return
	}
	out := Capabilities{WorkspaceID: workspace, Accounts: []AccountCapability{}}
	for _, a := range accounts {
		if a.WorkspaceID != workspace {
			http.Error(w, `{"error":"capabilities_unavailable"}`, http.StatusBadGateway)
			return
		}
		item := AccountCapability{ID: a.ID, Provider: a.Provider, Status: a.Status, AccountAlias: a.Label, AvailableRegions: []string{}, SupportedDomains: []string{}}
		if a.Status != "active" || a.VerifiedAt.IsZero() {
			item.Warning = "account_not_verified"
			out.Accounts = append(out.Accounts, item)
			continue
		}
		if a.Provider != "aws" {
			item.Warning = "provider_discovery_not_supported"
			out.Accounts = append(out.Accounts, item)
			continue
		}
		now := h.now().UTC()
		cached, err := h.discover(ctx, a, false)
		if err != nil {
			item.Warning = "provider_discovery_unavailable"
			out.Accounts = append(out.Accounts, item)
			continue
		}

		item.AccountIdentity = "********" + cached.value.AccountID[8:]
		item.AvailableRegions = append([]string{}, cached.value.Regions...)
		sort.Strings(item.AvailableRegions)
		for _, region := range item.AvailableRegions {
			if region == a.DefaultRegion {
				item.DefaultRegion = region
			}
		}
		if item.DefaultRegion == "" {
			item.DefaultRegion = item.AvailableRegions[0]
		}
		item.SupportedDomains = terraform.SupportedDomains(a.Provider)
		checked := cached.checked
		item.CheckedAt = &checked
		item.ExecutionReady = cached.value.PermissionsVerified && now.Sub(checked) < 24*time.Hour
		if !item.ExecutionReady {
			item.Warning = "execution_permissions_not_verified"
		}
		out.Accounts = append(out.Accounts, item)
	}
	sort.Slice(out.Accounts, func(i, j int) bool { return out.Accounts[i].ID < out.Accounts[j].ID })
	_ = json.NewEncoder(w).Encode(out)
}

type sqlCapabilityStore struct {
	db     *sql.DB
	master cloudcrypto.MasterKey
}

func (s sqlCapabilityStore) Accounts(ctx context.Context, workspace string) ([]CapabilityAccount, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT a.id,a.provider,a.label,a.status,a.metadata_encrypted,a.updated_at,a.verified_at
 FROM provisr_cloud.cloud_accounts a JOIN provisr_identity.workspaces w ON w.id=a.workspace_id
 WHERE a.workspace_id=$1 AND w.deleted_at IS NULL ORDER BY a.id`, workspace)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []CapabilityAccount
	for rows.Next() {
		a := CapabilityAccount{WorkspaceID: workspace}
		var encrypted sql.NullString
		var verified sql.NullTime
		if err := rows.Scan(&a.ID, &a.Provider, &a.Label, &a.Status, &encrypted, &a.UpdatedAt, &verified); err != nil {
			return nil, err
		}
		if verified.Valid {
			a.VerifiedAt = verified.Time
		}
		if a.Status == "active" && encrypted.Valid {
			key, err := cloudcrypto.DeriveWorkspaceKey(s.master, workspace)
			if err != nil {
				return nil, err
			}
			var metadata map[string]any
			if err := cloudcrypto.DecryptJSON(key, encrypted.String, &metadata); err != nil {
				return nil, fmt.Errorf("account metadata unavailable")
			}
			a.RoleARN, _ = metadata["role_arn"].(string)
			if a.RoleARN == "" {
				a.RoleARN, _ = metadata["roleArn"].(string)
			}
			a.ExternalID, _ = metadata["external_id"].(string)
			a.DefaultRegion, _ = metadata["default_region"].(string)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// redactDiscoverySecrets keeps delegated identity metadata off the existing detail surface.
func redactDiscoverySecrets(metadata map[string]any) {
	for key := range metadata {
		if strings.EqualFold(strings.ReplaceAll(key, "_", ""), "externalid") {
			delete(metadata, key)
		}
	}
}

func (h *capabilitiesHandler) discover(ctx context.Context, a CapabilityAccount, force bool) (capabilityCache, error) {
	key := a.WorkspaceID + ":" + a.ID + ":" + a.UpdatedAt.UTC().Format(time.RFC3339Nano)
	now := h.now().UTC()
	h.mu.Lock()
	cached, ok := h.cache[key]
	generation := h.generation[a.WorkspaceID]
	h.mu.Unlock()
	if ok && !force && now.Before(cached.expires) {
		return cached, nil
	}
	facts, err := h.provider.Discover(ctx, a)
	if err != nil || len(facts.AccountID) != 12 || len(facts.Regions) == 0 {
		return capabilityCache{}, fmt.Errorf("provider discovery unavailable")
	}
	cached = capabilityCache{value: facts, checked: now, expires: now.Add(time.Hour)}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.generation[a.WorkspaceID] != generation {
		return capabilityCache{}, fmt.Errorf("discovery invalidated by refresh")
	}
	for k, v := range h.cache {
		if !now.Before(v.expires) {
			delete(h.cache, k)
		}
	}
	if len(h.cache) >= 1024 {
		h.cache = map[string]capabilityCache{}
	}
	h.cache[key] = cached
	return cached, nil
}

// Refresh invalidates old readiness before attempting proactive live discovery.
func (h *capabilitiesHandler) Refresh(ctx context.Context, workspace string) {
	if h.token == "" {
		return
	}
	h.mu.Lock()
	h.generation[workspace]++
	for key := range h.cache {
		if strings.HasPrefix(key, workspace+":") {
			delete(h.cache, key)
		}
	}
	h.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	accounts, err := h.store.Accounts(ctx, workspace)
	if err != nil {
		return
	}
	for _, a := range accounts {
		if a.WorkspaceID == workspace && a.Status == "active" && a.Provider == "aws" && !a.VerifiedAt.IsZero() {
			_, _ = h.discover(ctx, a, true)
		}
	}
}

// NewStoredCapabilities creates one shared handler/cache for routes and refresh jobs.
func NewStoredCapabilities(db *sql.DB, master cloudcrypto.MasterKey, token string) http.Handler {
	return NewCapabilitiesHandler(sqlCapabilityStore{db: db, master: master}, AWSDiscovery{}, token)
}

// RunCapabilityRefresh performs startup/daily refresh until the service context ends.
func RunCapabilityRefresh(ctx context.Context, db *sql.DB, handler http.Handler) {
	if h, ok := handler.(*capabilitiesHandler); ok && h.token == "" {
		return
	}
	refresh, ok := handler.(interface{ Refresh(context.Context, string) })
	if !ok {
		return
	}
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT a.workspace_id FROM provisr_cloud.cloud_accounts a JOIN provisr_identity.workspaces w ON w.id=a.workspace_id WHERE a.status='active' AND w.deleted_at IS NULL`)
		var workspaces []string
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					workspaces = append(workspaces, id)
				}
			}
			_ = rows.Close()
		}
		for _, id := range workspaces {
			if ctx.Err() != nil {
				return
			}
			refresh.Refresh(ctx, id)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
