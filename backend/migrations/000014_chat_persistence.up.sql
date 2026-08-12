CREATE TYPE provisr_state.chat_turn_status AS ENUM ('accepted', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE provisr_state.chat_message_role AS ENUM ('user', 'assistant', 'system');

CREATE TABLE provisr_state.chat_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    requester_id UUID NOT NULL REFERENCES provisr_identity.users(id),
    client_message_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status provisr_state.chat_turn_status NOT NULL DEFAULT 'accepted',
    input JSONB NOT NULL,
    correlation_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, client_message_id),
    UNIQUE (workspace_id, requester_id, idempotency_key),
    UNIQUE (id, session_id, workspace_id),
    FOREIGN KEY (session_id, workspace_id)
        REFERENCES provisr_state.chat_sessions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE provisr_state.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    turn_id UUID NOT NULL,
    role provisr_state.chat_message_role NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (turn_id, session_id, workspace_id)
        REFERENCES provisr_state.chat_turns(id, session_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE provisr_events.chat_event_sequences (
    workspace_id UUID PRIMARY KEY,
    next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
    FOREIGN KEY (workspace_id)
        REFERENCES provisr_identity.workspaces(id) ON DELETE CASCADE
);

CREATE TABLE provisr_events.chat_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    turn_id UUID,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, sequence),
    FOREIGN KEY (session_id, workspace_id)
        REFERENCES provisr_state.chat_sessions(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (turn_id, session_id, workspace_id)
        REFERENCES provisr_state.chat_turns(id, session_id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_messages_session_created ON provisr_state.chat_messages(session_id, created_at, id);
CREATE INDEX idx_chat_events_workspace_sequence ON provisr_events.chat_events(workspace_id, sequence);
