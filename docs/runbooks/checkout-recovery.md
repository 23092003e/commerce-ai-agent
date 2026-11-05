# Checkout recovery

When price, product status, cart contents, or delivery fields change, the old confirmation must not be used. Collect any corrected fields and prepare a fresh summary with a new confirmation ID. Ask the customer to confirm the newly displayed summary explicitly. Never regenerate a summary after receiving consent and treat it as already approved.

`confirmation_stale` means the stored confirmation or current cart no longer matches the displayed snapshot. `confirmation_expired` means its 15-minute validity elapsed. `inventory_unavailable` means current stock cannot satisfy the requested quantity. These outcomes create no order and reserve no inventory. A consumed confirmation with an existing order is an idempotent replay and returns that same order; never create another order for that ID.

To investigate, query orders by the confirmation ID and inspect the checkout draft's prepared/expiry/consumed timestamps, cart status/version, order items and inventory reservation. A successful transaction has exactly one `confirmed` order, a converted cart, non-null consumed timestamp, and conversation checkout state `none`. A failed transaction has no order for that confirmation and no reservation from the failed attempt. Compare reservations with the recorded order quantity; other simultaneous purchases may legitimately change aggregate inventory.

Customer recovery text should describe the changed price/cart, elapsed summary, or stock shortage without exposing database errors or customer data in logs. Prepare and display the replacement summary before accepting new consent. Escalate uncertain delivery or inconsistent persisted state to a human; never manually reserve stock or insert an order to retry a failed confirmation.
