package events

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

func TestHTTPPublisher_DeliversToAllSubscribers(t *testing.T) {
	var mu sync.Mutex
	received := 0
	var receivedBodies [][]byte

	server1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		received++
		body := make([]byte, r.ContentLength)
		r.Body.Read(body)
		receivedBodies = append(receivedBodies, body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server1.Close()

	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		received++
		body := make([]byte, r.ContentLength)
		r.Body.Read(body)
		receivedBodies = append(receivedBodies, body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server2.Close()

	publisher := NewHTTPPublisher([]string{server1.URL, server2.URL})
	defer publisher.Close()

	event := models.StateChangedEvent{
		EventID:        uuid.New(),
		RequestID:      uuid.New(),
		OrgID:          uuid.New(),
		PreviousStatus: models.StatusReceived,
		NewStatus:      models.StatusPendingAgent,
		StateVersion:   2,
		Actor:          "system",
		Timestamp:      time.Now().UTC(),
		CorrelationID:  "test-correlation",
	}

	err := publisher.PublishStateChanged(context.Background(), event)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if received != 2 {
		t.Fatalf("expected 2 deliveries, got %d", received)
	}

	var parsedEvent models.StateChangedEvent
	if err := json.Unmarshal(receivedBodies[0], &parsedEvent); err != nil {
		t.Fatalf("failed to unmarshal event body: %v", err)
	}
	if parsedEvent.EventID != event.EventID {
		t.Fatalf("expected event_id %s, got %s", event.EventID, parsedEvent.EventID)
	}
	if parsedEvent.NewStatus != event.NewStatus {
		t.Fatalf("expected new_status %s, got %s", event.NewStatus, parsedEvent.NewStatus)
	}
}

func TestHTTPPublisher_HeadersAreSet(t *testing.T) {
	var contentType, eventType string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		eventType = r.Header.Get("X-Event-Type")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	publisher := NewHTTPPublisher([]string{server.URL})
	defer publisher.Close()

	event := models.StateChangedEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now().UTC(),
	}

	_ = publisher.PublishStateChanged(context.Background(), event)

	if contentType != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %s", contentType)
	}
	if eventType != "state.changed" {
		t.Fatalf("expected X-Event-Type state.changed, got %s", eventType)
	}
}

func TestHTTPPublisher_FailedSubscriberDoesNotBlock(t *testing.T) {
	successCount := 0
	var mu sync.Mutex

	flakyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer flakyServer.Close()

	goodServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		successCount++
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer goodServer.Close()

	deadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadServer.Close()

	publisher := NewHTTPPublisher([]string{goodServer.URL, flakyServer.URL, deadServer.URL})
	defer publisher.Close()

	event := models.StateChangedEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now().UTC(),
	}

	err := publisher.PublishStateChanged(context.Background(), event)
	if err == nil {
		t.Fatal("expected error due to subscriber failures, got nil")
	}

	if successCount != 1 {
		t.Fatalf("expected 1 successful delivery, got %d", successCount)
	}
}

func TestHTTPPublisher_NoSubscribers(t *testing.T) {
	publisher := NewHTTPPublisher(nil)
	defer publisher.Close()

	event := models.StateChangedEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now().UTC(),
	}

	err := publisher.PublishStateChanged(context.Background(), event)
	if err != nil {
		t.Fatalf("expected nil for no subscribers, got %v", err)
	}

	publisher2 := NewHTTPPublisher([]string{})
	defer publisher2.Close()

	err = publisher2.PublishStateChanged(context.Background(), event)
	if err != nil {
		t.Fatalf("expected nil for empty subscribers, got %v", err)
	}
}
