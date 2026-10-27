package secretscan

import (
	"bytes"
	"io"
	"strings"
	"sync"
)

// Redact replaces each detected secret with [REDACTED:<type>]. Use it on
// execution logs and other output that must be stored or shown even when it
// contains credentials. Findings are reported against name.
func Redact(name, content string) (string, []Finding) {
	findings := ScanText(name, content)
	spans := detect(content, false)
	if len(spans) == 0 {
		return content, findings
	}
	var b strings.Builder
	last := 0
	for _, s := range spans {
		b.WriteString(content[last:s.start])
		b.WriteString("[REDACTED:")
		b.WriteString(s.typ)
		b.WriteString("]")
		last = s.end
	}
	b.WriteString(content[last:])
	return b.String(), findings
}

// RedactingWriter redacts complete lines before forwarding them, so streamed
// Terraform output never reaches w unredacted. Multi-line private keys are
// held until their END marker. Close flushes any trailing partial line.
type RedactingWriter struct {
	mu       sync.Mutex
	w        io.Writer
	name     string
	buf      bytes.Buffer
	findings []Finding
}

// NewRedactingWriter wraps w; findings are reported against name.
func NewRedactingWriter(w io.Writer, name string) *RedactingWriter {
	return &RedactingWriter{w: w, name: name}
}

func (r *RedactingWriter) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf.Write(p)
	data := r.buf.String()
	cut := strings.LastIndexByte(data, '\n')
	if cut < 0 {
		return len(p), nil
	}
	// Hold an unterminated private key block rather than leaking its body.
	if begin := strings.LastIndex(data[:cut+1], "-----BEGIN "); begin >= 0 &&
		strings.Contains(data[begin:], "PRIVATE KEY") && !strings.Contains(data[begin:], "-----END ") {
		if begin == 0 {
			return len(p), nil
		}
		cut = strings.LastIndexByte(data[:begin], '\n')
		if cut < 0 {
			return len(p), nil
		}
	}
	if err := r.emit(data[:cut+1]); err != nil {
		return 0, err
	}
	r.buf.Reset()
	r.buf.WriteString(data[cut+1:])
	return len(p), nil
}

// Close flushes buffered output. It does not close the underlying writer.
func (r *RedactingWriter) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.buf.Len() == 0 {
		return nil
	}
	err := r.emit(r.buf.String())
	r.buf.Reset()
	return err
}

// Findings returns every finding redacted so far, for audit.
func (r *RedactingWriter) Findings() []Finding {
	r.mu.Lock()
	defer r.mu.Unlock()
	return normalize(append([]Finding(nil), r.findings...))
}

func (r *RedactingWriter) emit(chunk string) error {
	out, findings := Redact(r.name, chunk)
	r.findings = append(r.findings, findings...)
	_, err := io.WriteString(r.w, out)
	return err
}
