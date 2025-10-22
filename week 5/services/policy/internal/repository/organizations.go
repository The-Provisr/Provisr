package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrPolicyNotFound = errors.New("organization policy not found or incomplete")

type OrganizationPolicy struct {
	MonthlyBudgetUSD float64
	AllowedRegions   []string
	RequiredTags     []string
}

type OrganizationRepository struct {
	pool *pgxpool.Pool
}

func NewOrganizationRepository(pool *pgxpool.Pool) *OrganizationRepository {
	return &OrganizationRepository{pool: pool}
}

func (r *OrganizationRepository) GetOrganizationPolicy(ctx context.Context, orgID string) (OrganizationPolicy, error) {
	const query = `
		SELECT monthly_budget_usd, allowed_regions, required_tags
		FROM organizations
		WHERE org_id = $1
		  AND status = 'active'
		  AND monthly_budget_usd IS NOT NULL`

	var policy OrganizationPolicy
	err := r.pool.QueryRow(ctx, query, orgID).Scan(
		&policy.MonthlyBudgetUSD,
		&policy.AllowedRegions,
		&policy.RequiredTags,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OrganizationPolicy{}, ErrPolicyNotFound
		}
		return OrganizationPolicy{}, fmt.Errorf("get organization policy: %w", err)
	}

	return policy, nil
}
