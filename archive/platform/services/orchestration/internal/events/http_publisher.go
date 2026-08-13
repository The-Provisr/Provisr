package events

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

type HTTPPublisher struct {
	subscribers []string
	client      *http.Client
}

func NewHTTPPublisher(subscribers []string) *HTTPPublisher {
	return &HTTPPublisher{
		subscribers: subscribers,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (p *HTTPPublisher) PublishStateChanged(ctx context.Context, event models.StateChangedEvent) error {
	if len(p.subscribers) == 0 {
		return nil
	}

	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	var mu sync.Mutex
	var errs []error
	var wg sync.WaitGroup

	for _, url := range p.subscribers {
		wg.Add(1)
		go func(subURL string) {
			defer wg.Done()

			if err := p.deliver(ctx, subURL, body); err != nil {
				mu.Lock()
				errs = append(errs, fmt.Errorf("deliver to %s: %w", subURL, err))
				mu.Unlock()
			}
		}(url)
	}

	wg.Wait()

	if len(errs) > 0 {
		return fmt.Errorf("event delivery had %d failure(s)", len(errs))
	}
	return nil
}

func (p *HTTPPublisher) deliver(ctx context.Context, url string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Event-Type", "state.changed")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("non-2xx response: %d", resp.StatusCode)
	}

	return nil
}

func (p *HTTPPublisher) Close() error {
	p.client.CloseIdleConnections()
	return nil
}
