DROP INDEX IF EXISTS provisr_events.idx_chat_events_workspace_sequence;
DROP INDEX IF EXISTS provisr_state.idx_chat_messages_session_created;

DROP TABLE IF EXISTS provisr_events.chat_events;
DROP TABLE IF EXISTS provisr_events.chat_event_sequences;
DROP TABLE IF EXISTS provisr_state.chat_messages;
DROP TABLE IF EXISTS provisr_state.chat_turns;

DROP TYPE IF EXISTS provisr_state.chat_message_role;
DROP TYPE IF EXISTS provisr_state.chat_turn_status;

ALTER TABLE provisr_state.provisioning_runs
    DROP CONSTRAINT IF EXISTS uq_provisioning_runs_id_session_workspace;
