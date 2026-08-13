package provisr.policy

import rego.v1

default passed := false

passed if {
	count(violations) == 0
}

violations := array.concat(array.concat(budget_violations, region_violations), tag_violations)

budget_violations := [violation |
	input.manifest.estimated_monthly_cost_usd > input.monthly_budget_usd

	violation := {
		"rule": "monthly_budget_usd",
		"code": "BUDGET_EXCEEDED",
		"message": sprintf(
			"monthly_budget_usd rule failed: estimated monthly cost %.2f USD exceeds budget %.2f USD",
			[input.manifest.estimated_monthly_cost_usd, input.monthly_budget_usd],
		),
	}
]

region_violations := [violation |
	not allowed_region(input.manifest.region)

	violation := {
		"rule": "allowed_regions",
		"code": "REGION_NOT_ALLOWED",
		"message": sprintf("allowed_regions rule failed: region %q is not allowed", [input.manifest.region]),
	}
]

tag_violations := [violation |
	required_tag := input.required_tags[_]
	not has_required_tag(required_tag)

	violation := {
		"rule": "required_tags",
		"code": "MISSING_REQUIRED_TAG",
		"message": sprintf("required_tags rule failed: required tag %q is missing", [required_tag]),
	}
]

allowed_region(region) if {
	input.allowed_regions[_] == region
}

has_required_tag(tag) if {
	object.get(input.manifest.tags, tag, "") != ""
}
