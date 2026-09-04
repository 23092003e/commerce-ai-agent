CREATE TYPE handover_status AS ENUM ('pending', 'active', 'resolved');
CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  status handover_status NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX handovers_one_open_per_conversation ON handovers (conversation_id) WHERE status IN ('pending', 'active');
ALTER TABLE handovers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE handovers FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE handovers FROM authenticated; END IF;
END; $$;
