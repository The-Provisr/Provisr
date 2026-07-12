package provisr.policy

import rego.v1

default allow := false

allow if {
	count(deny) == 0
}

deny := array.concat(array.concat(budget_violations, region_violations), tag_violations)

budget_violations := [violation |
	input.manifest.estimated_monthly_cost_usd > input.monthly_budget_usd

	violation := {
		"code": "BUDGET_EXCEEDED",
		"message": sprintf(
			"Estimated monthly cost %.2f USD exceeds allowed budget %.2f USD.",
			[input.manifest.estimated_monthly_cost_usd, input.monthly_budget_usd],
		),
	}
]

region_violations := [violation |
	not allowed_region(input.manifest.region)

	violation := {
		"code": "REGION_NOT_ALLOWED",
		"message": sprintf("Region '%s' is not allowed for this organization.", [input.manifest.region]),
	}
]

tag_violations := [violation |
	required_tag := input.required_tags[_]
	not has_required_tag(required_tag)

	violation := {
		"code": "MISSING_REQUIRED_TAG",
		"message": sprintf("Required tag '%s' is missing.", [required_tag]),
	}
]

allowed_region(region) if {
	input.allowed_regions[_] == region
}

has_required_tag(tag) if {
	object.get(input.manifest.tags, tag, "") != ""
}