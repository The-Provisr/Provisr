package terraformplan

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func encodedPlan(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func planChange(address string, actions ...string) map[string]any {
	return map[string]any{
		"address": address, "mode": "managed", "type": "aws_instance",
		"change": map[string]any{"actions": actions, "before": nil, "after": map[string]any{"name": "web"}},
	}
}

func TestNormalizeSummarizesActionsAndSorts(t *testing.T) {
	update := planChange("aws_instance.exposed", "update")
	update["change"].(map[string]any)["after"] = map[string]any{"network": []any{map[string]any{"cidr": "::/0"}}}
	read := planChange("data.aws_ami.latest", "read")
	read["mode"] = "data"
	changes := []any{
		planChange("aws_instance.zreplace", "delete", "create"),
		planChange("aws_instance.areplace", "create", "delete"),
		planChange("aws_instance.new", "create"),
		planChange("aws_instance.old", "delete"),
		planChange("aws_instance.same", "no-op"), update, read,
	}
	input := map[string]any{"format_version": "1.2", "terraform_version": "1.9.8", "resource_changes": changes}
	summary, safe, err := Normalize(encodedPlan(t, input))
	if err != nil {
		t.Fatal(err)
	}
	if summary.CreateCount != 3 || summary.DeleteCount != 3 || summary.UpdateCount != 1 || summary.UnchangedCount != 1 {
		t.Fatalf("wrong counts: %+v", summary)
	}
	wantAddresses := []string{"aws_instance.areplace", "aws_instance.exposed", "aws_instance.new", "aws_instance.old", "aws_instance.same", "aws_instance.zreplace", "data.aws_ami.latest"}
	for index, item := range summary.Resources {
		if item.Address != wantAddresses[index] {
			t.Fatalf("noncanonical order: %+v", summary.Resources)
		}
	}
	if !reflect.DeepEqual(summary.Resources[0].RiskTags, []string{"destructive", "cost_impact"}) || summary.Resources[0].ChangeType != "replace" {
		t.Fatalf("replacement risks: %+v", summary.Resources[0])
	}
	if !reflect.DeepEqual(summary.Resources[1].RiskTags, []string{"cost_impact", "public_exposure"}) {
		t.Fatalf("update risks: %+v", summary.Resources[1])
	}
	if summary.Resources[6].ChangeType != "read" || len(summary.Resources[6].RiskTags) != 0 {
		t.Fatalf("read was treated as a mutation: %+v", summary.Resources[6])
	}
	for left, right := 0, len(changes)-1; left < right; left, right = left+1, right-1 {
		changes[left], changes[right] = changes[right], changes[left]
	}
	second, secondSafe, err := Normalize(encodedPlan(t, input))
	if err != nil || !reflect.DeepEqual(summary, second) || !bytes.Equal(safe, secondSafe) {
		t.Fatalf("normalization is not deterministic: %v", err)
	}
}

func TestNormalizeRedactsNestedSensitiveValuesAndDiscardsRawSections(t *testing.T) {
	change := planChange("aws_instance.web", "update")
	change["change"] = map[string]any{
		"actions":          []string{"update"},
		"before":           map[string]any{"nested": []any{map[string]any{"value": "BEFORE_SECRET", "name": "retain"}}},
		"before_sensitive": map[string]any{"nested": []any{map[string]any{"value": true}}},
		"after": map[string]any{
			"whole_object": map[string]any{"inner": "OBJECT_SECRET"},
			"whole_list":   []any{"LIST_SECRET", map[string]any{"inner": "LIST_NESTED_SECRET"}},
			"password":     "PASSWORD_SECRET", "api_key": "API_SECRET", "access_token": "TOKEN_SECRET",
			"private-key": "KEY_SECRET", "credentials": map[string]any{"value": "CREDENTIAL_SECRET"},
			"nested_values": map[string]any{
				"values":           map[string]any{"left": "OUTER_MASK_SECRET", "right": "INNER_MASK_SECRET", "safe": "public"},
				"sensitive_values": map[string]any{"right": true},
			},
			"name": "retain", "ref": "aws_vpc.main.id",
		},
		"after_sensitive": map[string]any{"whole_object": true, "whole_list": true,
			"nested_values": map[string]any{"values": map[string]any{"left": true}}},
	}
	plan := map[string]any{
		"format_version": "1.2", "resource_changes": []any{change},
		"prior_state":   map[string]any{"unmarked": "PRIOR_SECRET"},
		"configuration": map[string]any{"unmarked": "CONFIG_SECRET"},
		"variables":     map[string]any{"unmarked": "VARIABLE_SECRET"},
		"planned_values": map[string]any{
			"root_module": map[string]any{
				"resources": []any{map[string]any{
					"address": "aws_instance.web", "values": map[string]any{"nested": []any{"PLANNED_SECRET", "public"}},
					"sensitive_values": map[string]any{"nested": []any{true, false}},
				}},
				"child_modules": []any{map[string]any{"resources": []any{map[string]any{
					"address": "module.child.aws_instance.web", "values": map[string]any{"value": "CHILD_SECRET"}, "sensitive_values": true,
				}}}},
			},
			"outputs": map[string]any{"endpoint": map[string]any{"value": "OUTPUT_SECRET", "sensitive": true}},
		},
		"output_changes": map[string]any{"endpoint": map[string]any{
			"before": "OUTPUT_BEFORE_SECRET", "after": []any{"OUTPUT_AFTER_SECRET"}, "before_sensitive": true, "after_sensitive": true,
		}},
	}
	_, safe, err := Normalize(encodedPlan(t, plan))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(safe), "SECRET") || strings.Contains(string(safe), "prior_state") || strings.Contains(string(safe), "configuration") || strings.Contains(string(safe), "variables") {
		t.Fatalf("sensitive data or discarded sections leaked: %s", safe)
	}
	var result map[string]any
	if err := json.Unmarshal(safe, &result); err != nil {
		t.Fatal(err)
	}
	changes := result["resource_changes"].([]any)
	after := changes[0].(map[string]any)["change"].(map[string]any)["after"].(map[string]any)
	if after["name"] != "retain" || after["ref"] != "aws_vpc.main.id" {
		t.Fatalf("public values changed: %v", after)
	}
	if after["whole_object"].(map[string]any)["inner"] != redacted || after["whole_list"].([]any)[0] != redacted {
		t.Fatalf("whole collection masks not applied: %v", after)
	}
	root := result["planned_values"].(map[string]any)["root_module"].(map[string]any)
	values := root["resources"].([]any)[0].(map[string]any)["values"].(map[string]any)["nested"].([]any)
	if !reflect.DeepEqual(values, []any{redacted, "public"}) {
		t.Fatalf("sensitivity mask destroyed public sibling: %v", values)
	}
}

func TestNormalizeWholeBeforeAndAfterSensitivity(t *testing.T) {
	change := planChange("aws_instance.web", "update")
	change["change"] = map[string]any{
		"actions": []string{"update"}, "before": map[string]any{"value": "before-hidden"},
		"after": []any{map[string]any{"value": "after-hidden"}}, "before_sensitive": true, "after_sensitive": true,
	}
	_, safe, err := Normalize(encodedPlan(t, map[string]any{"format_version": "1.2", "resource_changes": []any{change}}))
	if err != nil || strings.Contains(string(safe), "hidden") {
		t.Fatalf("whole change mask failed: %s %v", safe, err)
	}
}

func TestNormalizeRejectsInvalidPlansWithoutEchoingContent(t *testing.T) {
	for _, actions := range []any{[]any{}, []string{"unknown"}, []string{"create", "update"}, []string{"delete", "create", "delete"}, []any{true}, "create"} {
		change := planChange("aws_instance.web", "create")
		change["change"].(map[string]any)["actions"] = actions
		_, safe, err := Normalize(encodedPlan(t, map[string]any{"format_version": "1.2", "resource_changes": []any{change}, "secret": "RAW_SECRET"}))
		if err == nil || safe != nil || strings.Contains(err.Error(), "RAW_SECRET") {
			t.Fatalf("accepted invalid actions: %v", actions)
		}
	}
	for _, raw := range [][]byte{
		[]byte(`{"format_version":"1.2","resource_changes":[]} {"secret":"RAW_SECRET"}`),
		[]byte(`{"resource_changes":[]}`), []byte(`{"format_version":1,"planned_values":{}}`),
		[]byte(`{"format_version":"1.2","resource_changes":{}}`),
		[]byte(`{"format_version":"1.2","resource_changes":null,"planned_values":{}}`),
		[]byte(`{"format_version":"1.2","resource_changes":[]}`), []byte(`[]`),
		bytes.Repeat([]byte(" "), maxPlanBytes+1),
	} {
		if _, safe, err := Normalize(raw); err == nil || safe != nil {
			t.Fatalf("accepted invalid JSON plan with length %d", len(raw))
		}
	}
}

func TestNormalizeEmptyPlanWithPlannedValues(t *testing.T) {
	for _, input := range []string{
		`{"format_version":"1.2","planned_values":{"root_module":{"resources":[]}}}`,
		`{"format_version":"1.2","planned_values":{},"resource_changes":[]}`,
	} {
		summary, safe, err := Normalize([]byte(input))
		if err != nil || len(summary.Resources) != 0 || len(safe) == 0 {
			t.Fatalf("valid empty plan rejected: %+v %v", summary, err)
		}
	}
}

func TestNormalizePublicBooleanRiskAndBlockedAccess(t *testing.T) {
	for _, tc := range []struct {
		name    string
		after   any
		exposed bool
	}{
		{"publicly_accessible", map[string]any{"publicly_accessible": true}, true},
		{"public_ipv4", map[string]any{"ingress": []any{map[string]any{"cidr_blocks": []any{"0.0.0.0/0"}}}}, true},
		{"private", map[string]any{"publicly_accessible": false, "cidr": "10.0.0.0/8"}, false},
		{"blocked_public_access", map[string]any{"block_public_acls": true}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			change := planChange("aws_instance.web", "update")
			change["change"].(map[string]any)["after"] = tc.after
			summary, _, err := Normalize(encodedPlan(t, map[string]any{"format_version": "1.2", "resource_changes": []any{change}}))
			if err != nil {
				t.Fatal(err)
			}
			exposed := false
			for _, tag := range summary.Resources[0].RiskTags {
				exposed = exposed || tag == "public_exposure"
			}
			if exposed != tc.exposed {
				t.Fatalf("public exposure=%v, want %v", exposed, tc.exposed)
			}
		})
	}
}

func TestNewPublicResourcesReceiveExposureRisk(t *testing.T) {
	for _, actions := range [][]string{{"create"}, {"delete", "create"}} {
		change := planChange("aws_instance.web", actions...)
		change["change"].(map[string]any)["after"] = map[string]any{"publicly_accessible": true}
		summary, _, err := Normalize(encodedPlan(t, map[string]any{"format_version": "1.2", "resource_changes": []any{change}}))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, tag := range summary.Resources[0].RiskTags {
			if tag == "public_exposure" {
				found = true
			}
		}
		if !found {
			t.Fatal("new public resource missing exposure risk")
		}
	}
}
