CREATE TABLE provisr_state.chat_turn_results (
    turn_id UUID PRIMARY KEY REFERENCES provisr_state.chat_turns(id) ON DELETE CASCADE,
    run_id UUID NOT NULL UNIQUE REFERENCES provisr_state.provisioning_runs(id) ON DELETE CASCADE,
    status provisr_state.chat_turn_status NOT NULL,
    result JSONB,
    error_code VARCHAR(64),
    error_message TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'completed' AND result IS NOT NULL AND error_code IS NULL)
        OR (status = 'failed' AND error_code IS NOT NULL)
        OR status IN ('accepted', 'running', 'cancelled'))
);

CREATE INDEX idx_chat_turn_results_run_id ON provisr_state.chat_turn_results(run_id);
