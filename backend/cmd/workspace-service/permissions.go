package main

// BE-A03: pure role-to-action permission matrix. Extracted from handler code
// so the authorization rules are unit-testable without HTTP or a database.

var validRoles = map[string]bool{
	"admin":    true,
	"engineer": true,
	"approver": true,
	"auditor":  true,
	"viewer":   true,
}

func validRole(role string) bool {
	return validRoles[role]
}

var rolePermissions = map[string]map[string]bool{
	"engineer": {
		"cloud_account.create":    true,
		"cloud_account.view":      true,
		"cloud_account.update":    true,
		"cloud_account.delete":    true,
		"chat_session.create":     true,
		"chat_session.view":       true,
		"chat_session.update":     true,
		"chat_session.delete":     true,
		"provisioning_run.create": true,
		"provisioning_run.view":   true,
		"manifest.view":           true,
		"artifact.view":           true,
	},
	"approver": {
		"approval_ticket.decide": true,
		"provisioning_run.view":  true,
	},
	"auditor": {
		"audit_event.view":      true,
		"provisioning_run.view": true,
		"manifest.view":         true,
		"artifact.view":         true,
	},
	"viewer": {
		"chat_session.view":     true,
		"provisioning_run.view": true,
	},
}

// isActionAllowed mirrors the sprint-plan matrix:
// admin=all, engineer=ops CRUD, approver=decide tickets,
// auditor=view audit/artifacts, viewer=read-only dashboard/sessions.
func isActionAllowed(role, resourceType, action string) bool {
	if role == "admin" {
		return true
	}
	perms, ok := rolePermissions[role]
	if !ok {
		return false
	}
	return perms[resourceType+"."+action]
}
