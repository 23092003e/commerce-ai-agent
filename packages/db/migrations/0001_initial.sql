CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE page_status AS ENUM ('active', 'paused');
CREATE TYPE conversation_status AS ENUM ('open', 'closed');
CREATE TYPE conversation_control_mode AS ENUM ('ai', 'human', 'paused');
CREATE TYPE checkout_state AS ENUM (
  'none',
  'collecting_name',
  'collecting_phone',
  'collecting_address',
  'collecting_payment',
  'awaiting_confirmation'
);
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_sender_type AS ENUM ('customer', 'ai', 'human', 'system');
CREATE TYPE message_type AS ENUM ('text', 'image', 'attachment', 'postback', 'system');
CREATE TYPE message_delivery_state AS ENUM ('received', 'queued', 'sent', 'delivered', 'failed');
CREATE TYPE webhook_processing_state AS ENUM (
  'received',
  'queued',
  'processing',
  'processed',
  'failed',
  'ignored'
);

CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_page_id text NOT NULL UNIQUE,
  name text NOT NULL,
  status page_status NOT NULL DEFAULT 'active',
  timezone text NOT NULL DEFAULT 'UTC',
  default_locale text NOT NULL DEFAULT 'vi_VN',
  ai_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES pages(id),
  meta_psid text NOT NULL,
  display_name text,
  phone text,
  email text,
  locale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, meta_psid)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES pages(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  status conversation_status NOT NULL DEFAULT 'open',
  control_mode conversation_control_mode NOT NULL DEFAULT 'ai',
  checkout_state checkout_state NOT NULL DEFAULT 'none',
  active_cart_id uuid,
  current_product_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_customer_message_at timestamptz,
  last_message_at timestamptz,
  last_summary text,
  summary_updated_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversations_one_open_per_customer
  ON conversations (page_id, customer_id)
  WHERE status = 'open';

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  meta_message_id text,
  direction message_direction NOT NULL,
  sender_type message_sender_type NOT NULL,
  message_type message_type NOT NULL,
  text text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_timestamp bigint,
  delivery_state message_delivery_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX messages_meta_message_id_unique
  ON messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_key text NOT NULL UNIQUE,
  page_id uuid REFERENCES pages(id),
  provider_page_id text,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_timestamp bigint,
  processing_state webhook_processing_state NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz
);

CREATE INDEX webhook_events_processing_state_idx
  ON webhook_events (processing_state, received_at);
