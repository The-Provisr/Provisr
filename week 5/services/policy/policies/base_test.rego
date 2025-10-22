package provisr.policy_test

import data.provisr.policy
import rego.v1

valid_input := {
	"org_id": "00000000-0000-0000-0000-000000000001",
	"monthly_budget_usd": 1000,
	"allowed_regions": ["us-east-1", "ap-south-1"],
	"required_tags": ["owner", "environment"],
	"manifest": {
		"provider": "aws",
		"region": "us-east-1",
		"estimated_monthly_cost_usd": 750,
		"tags": {
			"owner": "platform-team",
			"environment": "test",
		},
	},
}

test_budget_rule_passes if {
	violations := policy.budget_violations with input as valid_input
	count(violations) == 0
}

test_budget_rule_fails if {
	test_input := object.union(valid_input, {
		"manifest": object.union(valid_input.manifest, {"estimated_monthly_cost_usd": 1200}),
	})

	violations := policy.budget_violations with input as test_input
	some violation in violations
	violation.rule == "monthly_budget_usd"
	violation.code == "BUDGET_EXCEEDED"
}

test_region_rule_passes if {
	violations := policy.region_violations with input as valid_input
	count(violations) == 0
}

test_region_rule_fails if {
	test_input := object.union(valid_input, {
		"manifest": object.union(valid_input.manifest, {"region": "eu-west-3"}),
	})

	violations := policy.region_violations with input as test_input
	some violation in violations
	violation.rule == "allowed_regions"
	violation.code == "REGION_NOT_ALLOWED"
}

test_required_tags_rule_passes if {
	violations := policy.tag_violations with input as valid_input
	count(violations) == 0
}

test_required_tags_rule_fails if {
	input_without_manifest := object.remove(valid_input, {"manifest"})
	manifest_without_tags := object.remove(valid_input.manifest, {"tags"})
	test_input := object.union(input_without_manifest, {
		"manifest": object.union(manifest_without_tags, {"tags": {"owner": "platform-team"}}),
	})

	violations := policy.tag_violations with input as test_input
	some violation in violations
	violation.rule == "required_tags"
	violation.code == "MISSING_REQUIRED_TAG"
}

test_valid_manifest_passes if {
	policy.passed with input as valid_input
	violations := policy.violations with input as valid_input
	count(violations) == 0
}
