package policy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Manifest struct {
	Provider                string            `json:"provider"`
	Region                  string            `json:"region"`
	EstimatedMonthlyCostUSD float64           `json:"estimated_monthly_cost_usd"`
	Tags                    map[string]string `json:"tags"`
}

type EvaluateRequest struct {
	OrgID    uuid.UUID `json:"org_id"`
	Manifest Manifest  `json:"manifest"`
}

type Violation struct {
	Rule    string `json:"rule"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type EvaluateResponse struct {
	Passed     bool        `json:"passed"`
	Violations []Violation `json:"violations"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) Evaluate(ctx context.Context, input EvaluateRequest) (EvaluateResponse, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return EvaluateResponse{}, fmt.Errorf("marshal policy request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/v1/policy/evaluate",
		bytes.NewReader(body),
	)
	if err != nil {
		return EvaluateResponse{}, fmt.Errorf("create policy request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return EvaluateResponse{}, fmt.Errorf("call policy service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return EvaluateResponse{}, fmt.Errorf("policy service returned %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}

	var result EvaluateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return EvaluateResponse{}, fmt.Errorf("decode policy response: %w", err)
	}
	if result.Violations == nil {
		result.Violations = []Violation{}
	}
	return result, nil
}

func (c *Client) Close() {
	c.http.CloseIdleConnections()
}
