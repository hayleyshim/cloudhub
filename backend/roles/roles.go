package roles

import (
	"context"
	"fmt"

	cloudhub "github.com/snetsystems/cloudhub/backend"
)

type contextKey string

// ContextKey is the key used to specify the
// role via context
const ContextKey = contextKey("role")

func validRole(ctx context.Context) error {
	// prevents panic in case of nil context
	if ctx == nil {
		return fmt.Errorf("expect non nil context")
	}
	role, ok := ctx.Value(ContextKey).(string)
	// should never happen
	if !ok {
		return fmt.Errorf("expected role key to be a string")
	}
	switch role {
	case MemberRoleName, ViewerRoleName, EditorRoleName, AdminRoleName:
		return nil
	default:
		return fmt.Errorf("expected role key to be set")
	}
}

// CloudHub User Roles
const (
	MemberRoleName   = "member"
	ViewerRoleName   = "viewer"
	EditorRoleName   = "editor"
	AdminRoleName    = "admin"
	SuperAdminStatus = "superadmin"

	// Indicatior that the server should retrieve the default role for the organization.
	WildcardRoleName = "*"
)

var (
	// MemberRole is the role for a user who can only perform No operations.
	MemberRole = cloudhub.Role{
		Name: MemberRoleName,
	}

	// ViewerRole is the role for a user who can only perform READ operations on Dashboards, Rules, Sources, and Servers,
	ViewerRole = cloudhub.Role{
		Name: ViewerRoleName,
	}

	// EditorRole is the role for a user who can perform READ and WRITE operations on Dashboards, Rules, Sources, and Servers.
	EditorRole = cloudhub.Role{
		Name: EditorRoleName,
	}

	// AdminRole is the role for a user who can perform READ and WRITE operations on Dashboards, Rules, Sources, Servers, and Users
	AdminRole = cloudhub.Role{
		Name: AdminRoleName,
	}
)
