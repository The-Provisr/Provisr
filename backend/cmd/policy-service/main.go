package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

// PolicyRequirements is the MCP-003 pre-flight contract. The orchestrator
// snapshots it on the run before it permits manifest creation.
type PolicyRequirements struct {
	AllowedRegions          []string          `json:"allowed_regions"`
	MaxBudget               float64           `json:"max_budget"`
	RequiredTags            map[string]string `json:"required_tags"`
	ProhibitedResourceTypes []string          `json:"prohibited_resource_types"`
	RequiredEncryption      bool              `json:"required_encryption"`
	RequiredBackup          bool              `json:"required_backup"`
}

var defaultPolicyRequirements = PolicyRequirements{
	AllowedRegions:          []string{"us-east-1", "us-west-2"},
	MaxBudget:               500,
	RequiredTags:            map[string]string{"managed-by": "provisr", "owner": "platform"},
	ProhibitedResourceTypes: []string{"aws_iam_user"},
	RequiredEncryption:      true,
	RequiredBackup:          true,
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /workspaces/{workspace_id}/policy-requirements", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"workspace_id": r.PathValue("workspace_id"),
			"enabled":      true,
			"requirements": defaultPolicyRequirements,
		})
	})

	log.Printf("policy-service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
