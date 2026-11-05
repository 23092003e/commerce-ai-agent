# Turn delivery and conversation control evidence

Implemented on `feat/portfolio-release`; no deployment or push performed.

## Durable turn lifecycle

- A session advisory lease on `meta:<page>:<customer>` spans event claiming,
  inbound persistence, agent/model/tools, outbound planning/send, and event
  completion. The keyed memory adapter releases after both success and failure.
- Inbound persistence no longer completes the webhook. Handler failure returns
  the event to `queued`; replay resolves the original message and conversation.
- Migration `0013` adds outbound state metadata, deterministic key uniqueness,
  one agent run per inbound, and unique positive tool step numbers. Historical
  messages are not synthesized or marked sent.
- Every reply path plans immutable text before calling the channel. Only a
  definite rate-limit rejection is retried. Retry resumes stored text without
  asking the model again. Interrupted `sending`, timeout, network, malformed
  response, and server errors are uncertain and are not automatically resent.
- A persisted sent row is a no-op on replay. An interrupted existing agent run
  with no outbound plan conservatively opens handover instead of replaying
  mutation tools. This intentionally does not promise recovery of partial
  model reasoning after process loss.
- Agent failures before planning now open handover. Safe error codes replace
  raw error payloads in agent logging and run failure metadata.
- The awaited queue processor finalizes only the final attempt. The `failed`
  event does not finalize. Finalizer failure emits an error while preserving
  the original job failure. DB finalization checks terminal state under lease.

## Conversation control

- Migration `0015` records admin actor, action, target, before/after mode and
  version, and timestamp. No customer text, recipient PSID or secret is included.
- One PostgreSQL control transaction owns takeover, pause, return to AI and
  idempotent handover. It acquires the same advisory key (or reuses the worker's
  lease), locks the row, validates admin versions, updates handovers and writes
  audit atomically. Return to AI resolves all open handovers; pause preserves
  existing records. Agent handover does not trust a stale model version.
- Outbound send claiming atomically verifies live AI mode. Admin history already
  selects all message directions and exposes delivery state without recipient
  or raw provider error fields.

## Verification

- Red lifecycle tests demonstrated premature `processed` and absent mutex.
- Red recovery tests demonstrated provider rerun/lost retry and network resend.
- Red queue tests demonstrated double finalization and overwritten job errors.
- Red channel tests demonstrated ambiguous 5xx and timeout retryability.
- Focused unit checks: 3 files / 18 tests green, then channel/concurrency checks
  3 files / 11 tests green; handler suite 14 tests green after consent wiring.
- Focused PostgreSQL/Redis checks: 4 files / 10 tests green, including immutable
  outbound deduplication, sending-to-unknown, one agent run, handler ordering,
  cross-customer concurrency, replay after failure, idempotent handover and
  admin transition/audit integrity.
- Full unit suite at this checkpoint: 164 tests pass, 1 browser test fails
  (`App.test.tsx`: Node/jsdom localStorage shape); the security agent owns that
  repair. Typecheck is pending concurrent commerce edits; current errors were
  reported to their owner. Parent performs the final combined release gate.

## Operator boundary

`queued`/`retryable` outbound rows may retry automatically with their stored
text. `unknown` and `failed` require staff follow-up. Never reset an uncertain
row to queued: Messenger has no application idempotency key and acceptance may
already have occurred. Verify provider/customer-visible history before any
manual customer follow-up. Event `processed` means sent, explicitly suppressed,
or handed over; persistence alone does not mean completion.
