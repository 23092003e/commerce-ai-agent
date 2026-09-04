CREATE TYPE agent_run_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE agent_run_outcome AS ENUM ('replied', 'handed_over', 'no_action', 'failed');
CREATE TYPE tool_call_status AS ENUM ('succeeded', 'failed');

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  inbound_message_id uuid NOT NULL REFERENCES messages(id),
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status agent_run_status NOT NULL DEFAULT 'running',
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  latency_ms integer CHECK (latency_ms >= 0),
  final_outcome agent_run_outcome,
  error text
);

CREATE INDEX agent_runs_conversation_started_idx
  ON agent_runs (conversation_id, started_at DESC);

CREATE TABLE tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status tool_call_status NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_calls_agent_run_idx ON tool_calls (agent_run_id, created_at);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE agent_runs, tool_calls FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE agent_runs, tool_calls FROM authenticated;
  END IF;
END;
$$;
