package orchestration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TransitionRequest struct {
	NewStatus       string  `json:"new_status"`
	ExpectedVersion int     `json:"expected_version"`
	ErrorCode       *string `json:"error_code,omitempty"`
	ErrorMessage    *string `json:"error_message,omitempty"`
	Actor           string  `json:"actor"`
}

type ResponseError struct {
	StatusCode int
	Body       string
}

func (e *ResponseError) Error() string {
	return fmt.Sprintf("orchestration returned %d: %s", e.StatusCode, e.Body)
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

func (c *Client) Transition(ctx context.Context, requestID string, input TransitionRequest) (json.RawMessage, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("marshal transition request: %w", err)
	}

	endpoint := c.baseURL + "/v1/requests/" + url.PathEscape(requestID) + "/transition"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create transition request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call orchestration service: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read orchestration response: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, &ResponseError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(responseBody))}
	}
	if !json.Valid(responseBody) {
		return nil, fmt.Errorf("orchestration returned invalid JSON")
	}
	return json.RawMessage(responseBody), nil
}

func (c *Client) Close() {
	c.http.CloseIdleConnections()
}
