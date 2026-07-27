DROP TABLE IF EXISTS provisr_state.provisioning_runs CASCADE;
DROP TABLE IF EXISTS provisr_state.chat_sessions CASCADE;

DROP TYPE IF EXISTS provisr_state.execution_status;
DROP TYPE IF EXISTS provisr_state.approval_status;
DROP TYPE IF EXISTS provisr_state.policy_decision;
DROP TYPE IF EXISTS provisr_state.run_state;
DROP TYPE IF EXISTS provisr_state.session_status;

DROP SCHEMA IF EXISTS provisr_state CASCADE;
