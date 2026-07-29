package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// Integration tests. DB resolution:
//   1. TEST_DATABASE_URL set -> use that postgres (test database is created
//      inside it via the "postgres" maintenance db; the target db itself is
//      never touched). This is the primary path — also used in CI.
//   2. Otherwise, when built with `-tags testcontainers`, start ephemeral
//      postgres:16-alpine via testcontainers (Docker required).
//   3. Neither available -> integration tests skip so `go test ./...`
//      passes anywhere.

func setupTestServer(t *testing.T) (*server, string, func()) {
	t.Helper()
	return setupTestServerWithDB(t, setupTestDB(t))
}

func setupTestServerWithDB(t *testing.T, db *sql.DB) (*server, string, func()) {
	t.Helper()
	var out io.Writer = io.Discard
	if os.Getenv("TEST_VERBOSE") != "" {
		out = zerolog.ConsoleWriter{Out: os.Stderr}
	}
	logger := zerolog.New(out)
	s := &server{db: db, log: logger}
	ts := httptest.NewServer(recoveryMiddleware(logger, s.routes()))
	return s, ts.URL, func() { ts.Close() }
}

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()

	var adminDSN string
	if env := os.Getenv("TEST_DATABASE_URL"); env != "" {
		adminDSN = toAdminDSN(env)
	} else {
		adminDSN = startTestContainer(t)
		if adminDSN == "" {
			t.Skip("docker unavailable and TEST_DATABASE_URL not set")
		}
	}

	admin, err := sql.Open("postgres", adminDSN)
	if err != nil {
		t.Fatalf("open admin connection: %v", err)
	}
	defer admin.Close()

	dbName := "provisr_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if _, err := admin.Exec("CREATE DATABASE " + dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec("DROP DATABASE " + dbName + " WITH (FORCE)"); err != nil && admin.Ping() == nil {
			t.Logf("drop test database failed: %v", err)
		}
	})

	db, err := sql.Open("postgres", withDBName(adminDSN, dbName))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	runMigrations(t, db)
	return db
}

// swapDBName rewrites the database name segment of a postgres URL.
func swapDBName(url, name string) string {
	idx := strings.LastIndex(url, "?")
	base := url
	query := ""
	if idx >= 0 {
		base = url[:idx]
		query = url[idx:]
	}
	slash := strings.LastIndex(base, "/")
	if slash < 0 {
		return url
	}
	return base[:slash+1] + name + query
}

func toAdminDSN(url string) string {
	return swapDBName(url, "postgres")
}

func withDBName(url, name string) string {
	return swapDBName(url, name)
}

func startTestContainer(t *testing.T) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	ctr, err := startPostgresContainer(ctx)
	if err != nil {
		t.Logf("testcontainers unavailable: %v", err)
		return ""
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = ctr.Terminate(ctx)
	})

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get test container connection string: %v", err)
	}
	return dsn
}

// containerTestIface is the minimal surface the harness needs from a
// postgres container; satisfied by testcontainers.Container and the stub.
type containerTestIface interface {
	Terminate(ctx context.Context) error
	ConnectionString(ctx context.Context, args ...string) (string, error)
}

// Without the `testcontainers` build tag there is no container provider;
// startPostgresContainer reports failure so the suite skips.
func startPostgresContainer(ctx context.Context) (containerTestIface, error) {
	return nil, fmt.Errorf("testcontainers build tag not enabled (use -tags testcontainers)")
}

func runMigrations(t *testing.T, db *sql.DB) {
	t.Helper()
	dir := filepath.Join("..", "..", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read migration %s: %v", name, err)
		}
		for _, stmt := range splitStatements(string(raw)) {
			if _, err := db.Exec(stmt); err != nil {
				t.Fatalf("migration %s failed: %v\nstatement:\n%s", name, err, stmt)
			}
		}
	}
}

// splitStatements splits migration DDL into single statements. All backend
// migrations are plain DDL, one ";" per line, with no PL/pgSQL blocks.
// Comment lines are stripped from each statement segment so a statement that
// is preceded by a comment block still executes.
func splitStatements(sqlText string) []string {
	var out []string
	for _, part := range strings.Split(sqlText, ";\n") {
		var lines []string
		for _, line := range strings.Split(part, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "--") {
				continue
			}
			lines = append(lines, line)
		}
		stmt := strings.TrimSpace(strings.Join(lines, "\n"))
		stmt = strings.TrimSuffix(stmt, ";")
		if stmt = strings.TrimSpace(stmt); stmt != "" {
			out = append(out, stmt)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// request/response helpers
// ---------------------------------------------------------------------------

// doRaw performs an HTTP call and returns the decoded JSON value.
func doRaw(t *testing.T, method, url, body string, header map[string]string) (*http.Response, any) {
	t.Helper()
	resp, raw := doRequest(t, method, url, body, header)
	var parsed any
	_ = json.Unmarshal(raw, &parsed)
	return resp, parsed
}

func doJSON(t *testing.T, method, url, body string, header map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	resp, parsed := doRaw(t, method, url, body, header)
	m, _ := parsed.(map[string]any)
	return resp, m
}

func doRequest(t *testing.T, method, url, body string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request %s %s: %v", method, url, err)
	}
	t.Cleanup(func() { resp.Body.Close() })

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	return resp, raw
}

func newUUID() string {
	return uuid.NewString()
}

func seedUser(t *testing.T, db *sql.DB, id, email string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO provisr_identity.users (id, clerk_id, name, email) VALUES ($1::uuid, $1::text, $2, $3)`,
		id, "Test User", email,
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func assertStatus(t *testing.T, want int, resp *http.Response) {
	t.Helper()
	if resp.StatusCode != want {
		t.Fatalf("status = %d, want %d (body: %v)", resp.StatusCode, want, resp)
	}
}
