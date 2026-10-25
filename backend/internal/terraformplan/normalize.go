// Package terraformplan summarizes and redacts Terraform show -json output.
package terraformplan

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
)

const maxPlanBytes = 16 * 1024 * 1024
const redacted = "[REDACTED]"

type Summary struct {
	CreateCount    int              `json:"create_count"`
	UpdateCount    int              `json:"update_count"`
	DeleteCount    int              `json:"delete_count"`
	UnchangedCount int              `json:"unchanged_count"`
	Resources      []ResourceChange `json:"resource_changes"`
}

type ResourceChange struct {
	Address      string   `json:"address"`
	ChangeType   string   `json:"change_type"`
	ResourceType string   `json:"resource_type"`
	RiskTags     []string `json:"risk_tags"`
}

// Normalize returns only a bounded, allowlisted, redacted plan and its summary.
// Errors never include plan content, which may contain unredacted credentials.
func Normalize(raw []byte) (Summary, json.RawMessage, error) {
	fail := func() (Summary, json.RawMessage, error) {
		return Summary{}, nil, errors.New("invalid Terraform plan JSON")
	}
	if len(raw) == 0 || len(raw) > maxPlanBytes {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var plan map[string]any
	if err := decoder.Decode(&plan); err != nil || plan == nil {
		return fail()
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fail()
	}
	format, ok := plan["format_version"].(string)
	if !ok || strings.TrimSpace(format) == "" {
		return fail()
	}
	_, hasPlannedValues := plan["planned_values"].(map[string]any)
	changes, hasChanges := plan["resource_changes"].([]any)
	if (!hasChanges || len(changes) == 0) && !hasPlannedValues {
		return fail()
	}
	if _, exists := plan["resource_changes"]; exists && !hasChanges {
		return fail()
	}

	if len(changes) > 1000 {
		return fail()
	}
	summary := Summary{Resources: []ResourceChange{}}
	for _, entry := range changes {
		resource, ok := entry.(map[string]any)
		if !ok {
			return fail()
		}
		address, addressOK := resource["address"].(string)
		resourceType, typeOK := resource["type"].(string)
		change, changeOK := resource["change"].(map[string]any)
		if !addressOK || strings.TrimSpace(address) == "" || !typeOK || strings.TrimSpace(resourceType) == "" || !changeOK {
			return fail()
		}
		mode := "managed"
		if value, exists := resource["mode"]; exists {
			mode, ok = value.(string)
			if !ok || (mode != "managed" && mode != "data") {
				return fail()
			}
		}
		kind, ok := actionType(change["actions"])
		if !ok {
			return fail()
		}
		item := ResourceChange{Address: address, ResourceType: resourceType, ChangeType: kind, RiskTags: []string{}}
		if mode == "managed" {
			switch kind {
			case "create":
				summary.CreateCount++
			case "update":
				summary.UpdateCount++
			case "delete":
				summary.DeleteCount++
			case "replace":
				summary.CreateCount++
				summary.DeleteCount++
			case "no-op":
				summary.UnchangedCount++
			}
		}
		if kind == "delete" || kind == "replace" {
			item.RiskTags = append(item.RiskTags, "destructive")
		}
		if kind == "create" || kind == "update" || kind == "delete" || kind == "replace" {
			item.RiskTags = append(item.RiskTags, "cost_impact")
		}
		if (kind == "create" || kind == "update" || kind == "replace") && publicExposure(change["after"]) {
			item.RiskTags = append(item.RiskTags, "public_exposure")
		}
		summary.Resources = append(summary.Resources, item)
	}
	sort.SliceStable(summary.Resources, func(i, j int) bool {
		left, right := summary.Resources[i], summary.Resources[j]
		return left.Address < right.Address || (left.Address == right.Address && left.ChangeType < right.ChangeType)
	})
	if hasChanges {
		sort.SliceStable(changes, func(i, j int) bool {
			left, right := changes[i].(map[string]any), changes[j].(map[string]any)
			if left["address"] != right["address"] {
				return left["address"].(string) < right["address"].(string)
			}
			leftJSON, _ := json.Marshal(left)
			rightJSON, _ := json.Marshal(right)
			return bytes.Compare(leftJSON, rightJSON) < 0
		})
	}
	safe := make(map[string]any)
	for _, key := range []string{"format_version", "terraform_version", "resource_changes", "planned_values", "output_changes"} {
		if value, exists := plan[key]; exists {
			safe[key] = redact(value, nil)
		}
	}
	encoded, err := json.Marshal(safe)
	if err != nil {
		return Summary{}, nil, errors.New("encode redacted Terraform plan")
	}
	return summary, encoded, nil
}

func actionType(value any) (string, bool) {
	actions, ok := value.([]any)
	if !ok {
		return "", false
	}
	if len(actions) == 1 {
		action, ok := actions[0].(string)
		if !ok {
			return "", false
		}
		switch action {
		case "no-op", "create", "update", "delete", "read":
			return action, true
		}
	}
	if len(actions) == 2 && ((actions[0] == "delete" && actions[1] == "create") || (actions[0] == "create" && actions[1] == "delete")) {
		return "replace", true
	}
	return "", false
}

func credentialField(name string) bool {
	key := strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "").Replace(name))
	return strings.Contains(key, "password") || strings.Contains(key, "privatekey") ||
		strings.Contains(key, "credential") || strings.Contains(key, "secret") ||
		key == "token" || key == "tokens" || strings.HasSuffix(key, "token") ||
		key == "apikey" || key == "accesskey" || key == "accesskeyid" || key == "awsaccesskeyid"
}

func redact(value, mask any) any {
	all, _ := mask.(bool)
	switch value := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(value))
		maskMap, _ := mask.(map[string]any)
		for key, child := range value {
			childMask := maskMap[key]
			if all || credentialField(key) {
				childMask = true
			}
			switch key {
			case "before", "after":
				childMask = mergeMasks(childMask, value[key+"_sensitive"])
			case "values":
				childMask = mergeMasks(childMask, value["sensitive_values"])
			case "value":
				childMask = mergeMasks(childMask, value["sensitive"])
			}
			result[key] = redact(child, childMask)
		}
		return result
	case []any:
		result := make([]any, len(value))
		maskList, _ := mask.([]any)
		for index, child := range value {
			var childMask any
			if all {
				childMask = true
			} else if index < len(maskList) {
				childMask = maskList[index]
			}
			result[index] = redact(child, childMask)
		}
		return result
	default:
		if all && value != nil {
			return redacted
		}
		return value
	}
}

func mergeMasks(left, right any) any {
	if left == true || right == true {
		return true
	}
	if left == nil || left == false {
		return right
	}
	if right == nil || right == false {
		return left
	}
	switch left := left.(type) {
	case map[string]any:
		result := make(map[string]any, len(left))
		for key, mask := range left {
			result[key] = mask
		}
		if right, ok := right.(map[string]any); ok {
			for key, mask := range right {
				result[key] = mergeMasks(result[key], mask)
			}
		}
		return result
	case []any:
		if right, ok := right.([]any); ok {
			result := make([]any, max(len(left), len(right)))
			copy(result, left)
			for index, mask := range right {
				result[index] = mergeMasks(result[index], mask)
			}
			return result
		}
	}
	return left
}

func publicExposure(value any) bool {
	switch value := value.(type) {
	case string:
		return value == "0.0.0.0/0" || value == "::/0"
	case []any:
		for _, child := range value {
			if publicExposure(child) {
				return true
			}
		}
	case map[string]any:
		for key, child := range value {
			if enabled, ok := child.(bool); ok && enabled {
				switch key {
				case "public", "publicly_accessible", "associate_public_ip_address", "map_public_ip_on_launch", "public_network_access_enabled", "public_access_enabled":
					return true
				}
			}
			if publicExposure(child) {
				return true
			}
		}
	}
	return false
}
