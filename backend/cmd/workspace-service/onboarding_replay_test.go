package main

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

func TestOnboardingWorkspaceCreateReplay(t *testing.T) {
	s, baseURL := setupTestServer(t)
	creatorID, otherCreatorID := newUUID(), newUUID()
	seedUser(t, s.db, creatorID, "creator@example.test")
	seedUser(t, s.db, otherCreatorID, "other@example.test")
	key := newUUID()
	headers := map[string]string{"Idempotency-Key": key}
	payload := map[string]any{
		"name": "Onboarding team", "description": "Team workspace", "environment": "dev",
		"creator_id": creatorID, "avatar": "🚀", "providers": []string{"gcp", "aws"},
	}
	marshal := func(input map[string]any) string {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatalf("marshal create: %v", err)
		}
		return string(body)
	}

	firstResponse, first := doJSON(t, http.MethodPost, baseURL+"/workspaces", marshal(payload), headers)
	assertStatus(t, http.StatusCreated, firstResponse)
	if first["id"] == nil || first["slug"] == nil {
		t.Fatalf("missing created workspace: %v", first)
	}

	for _, providerOrder := range [][]string{{"gcp", "aws"}, {"aws", "gcp"}} {
		payload["providers"] = providerOrder
		replayResponse, replay := doJSON(t, http.MethodPost, baseURL+"/workspaces", marshal(payload), headers)
		assertStatus(t, http.StatusCreated, replayResponse)
		if !reflect.DeepEqual(first, replay) {
			t.Fatalf("retry changed workspace: first=%v replay=%v", first, replay)
		}
	}

	for _, change := range []struct {
		name  string
		field string
		value any
	}{
		{"name", "name", "Another team"},
		{"environment", "environment", "prod"},
		{"description", "description", "Changed description"},
		{"avatar", "avatar", "☁️"},
		{"providers", "providers", []string{"azure"}},
		{"foreign creator", "creator_id", otherCreatorID},
	} {
		t.Run(change.name, func(t *testing.T) {
			changed := make(map[string]any, len(payload))
			for field, value := range payload {
				changed[field] = value
			}
			changed[change.field] = change.value
			response, result := doJSON(t, http.MethodPost, baseURL+"/workspaces", marshal(changed), headers)
			assertStatus(t, http.StatusConflict, response)
			if result["error"] != "duplicate_idempotency_key" {
				t.Fatalf("wrong conflict code: %v", result)
			}
			for _, field := range []string{"id", "name", "slug", "creator_id", "workspace_id"} {
				if _, found := result[field]; found {
					t.Fatalf("conflict leaked workspace field %q: %v", field, result)
				}
			}
		})
	}

	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM provisr_identity.workspaces WHERE idempotency_key=$1`, key).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("created %d workspaces for one key, want 1", count)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM provisr_identity.memberships WHERE workspace_id=$1`, first["id"]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("created %d memberships, want 1", count)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM provisr_audit.audit_events WHERE workspace_id=$1 AND event_type='workspace_created'`, first["id"]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("created %d workspace_created audit events, want 1", count)
	}
	var settingsJSON []byte
	if err := s.db.QueryRow(`SELECT settings FROM provisr_identity.workspaces WHERE id=$1`, first["id"]).Scan(&settingsJSON); err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Avatar    string   `json:"avatar"`
		Providers []string `json:"providers"`
	}
	if err := json.Unmarshal(settingsJSON, &settings); err != nil {
		t.Fatal(err)
	}
	if settings.Avatar != "🚀" || !reflect.DeepEqual(settings.Providers, []string{"aws", "gcp"}) {
		t.Fatalf("onboarding settings were not persisted and normalized: %+v", settings)
	}
}
