# Facebook Fanpage AI Sales Agent

Agent tư vấn bán hàng cho Facebook Fanpage bằng TypeScript. Hệ thống nhận Messenger webhook, lưu bền vững, xử lý đúng thứ tự, tra catalog/knowledge, chạy AI và trả lời theo chế độ AI hoặc nhân viên.

> Hiện chạy end-to-end với Meta Graph API, Cloudflare Tunnel và OpenRouter. Catalog **Bánh Mây Atelier** là dữ liệu demo hư cấu, không phải dữ liệu kinh doanh thật.

## Kiến trúc

```text
Khách Messenger
  -> Facebook Messenger Platform
  -> Cloudflare Tunnel (HTTPS)
  -> Fastify API: HMAC verify -> validate -> webhook_events
  -> Redis / BullMQ: durable, deduplicated event job
  -> Inbound worker: ordered claim -> conversation/message persist
  -> Bounded agent: catalog, knowledge, cart, checkout tools
  -> OpenRouter / OpenAI decision provider
  -> Meta Send API -> Khách

PostgreSQL giữ pages, customers, conversations, messages, agent_runs,
tool_calls, handovers, products, variants, inventory và knowledge chunks.
```

| Thành phần        | Trách nhiệm                                 |
| ----------------- | ------------------------------------------- |
| `apps/api`        | Fastify, webhook, worker composition        |
| `packages/meta`   | HMAC, Messenger schema, fake/Graph channel  |
| `packages/queue`  | BullMQ queue, retry và ordered processing   |
| `packages/db`     | PostgreSQL schema, migrations, repositories |
| `packages/domain` | Agent, catalog, cart, checkout, knowledge   |
| `packages/config` | Validate biến môi trường bằng Zod           |

## Luồng xử lý

1. Facebook gọi `POST /webhooks/meta`.
2. API xác thực raw body bằng `X-Hub-Signature-256` và `META_APP_SECRET`.
3. Payload được validate, dedupe trong `webhook_events` rồi enqueue với job ID xác định.
4. Worker xử lý đúng thứ tự từng Page/customer, persist inbound message idempotent.
5. Mode `human` hoặc `paused` chặn tự động trả lời; mode `ai` chạy agent tối đa sáu tool steps.
6. Giá, tồn kho, chính sách và đơn hàng chỉ được nêu sau tool result tương ứng.
7. Agent run, tool call, handover và lỗi được lưu để truy vết.

## Yêu cầu

- Node.js 22+
- pnpm 11.7+
- Docker Desktop với Linux containers
- Meta App + Page access token khi dùng Facebook thật
- OpenRouter hoặc OpenAI API key khi dùng AI thật

## Chạy local (PowerShell)

```powershell
pnpm.cmd install
Copy-Item -LiteralPath .env.example -Destination .env
docker compose up -d postgres redis
pnpm.cmd db:migrate
pnpm.cmd dev
```

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ready
```

`/health` kiểm tra process. `/ready` kiểm tra PostgreSQL và Redis; trả HTTP 503 nếu dependency chưa sẵn sàng.

## Cấu hình

Không commit hoặc gửi `.env`, token hay API key qua chat.

### Fake mode

```env
META_ADAPTER=fake
AI_PROVIDER=fake
```

### Facebook Graph API

```env
META_ADAPTER=graph
META_APP_SECRET=<meta-app-secret>
META_VERIFY_TOKEN=<random-string-it-nhat-16-ky-tu>
META_PAGE_ACCESS_TOKEN=<page-access-token>
META_GRAPH_API_VERSION=v23.0
```

Callback cần HTTPS public, ví dụ `https://api.example.com/webhooks/meta`. Trong Meta Developers, verify callback, connect đúng Page và subscribe trường `messages`.

### OpenRouter

```env
AI_PROVIDER=openrouter
AI_MODEL=deepseek/deepseek-v4-flash
AI_API_KEY=<openrouter-api-key>
```

Provider dùng Responses API với JSON Schema, chỉ cho phép tên tool hợp lệ. Reasoning bị tắt cho luồng sale để ưu tiên phản hồi ngắn và ổn định.

### Nhịp phản hồi

```env
HUMAN_REPLY_DELAY_ENABLED=true
HUMAN_REPLY_DELAY_MIN_MS=800
HUMAN_REPLY_DELAY_MAX_MS=2600
HUMAN_REPLY_TYPING_CHARS_PER_SECOND=20
```

Delay dùng asynchronous timer, không busy-wait. Đặt `HUMAN_REPLY_DELAY_ENABLED=false` để test phản hồi tức thì.

## Cloudflare Tunnel

1. Tạo managed tunnel trong Cloudflare Zero Trust.
2. Tạo public hostname, ví dụ `api.example.com`.
3. Route hostname tới `http://localhost:3000`.
4. Cài Cloudflared service để tunnel tự chạy cùng Windows.
5. Kiểm tra `https://api.example.com/ready` trước khi verify callback trên Meta.

Máy chạy tunnel, API, Docker, PostgreSQL và Redis phải bật thì bot mới hoạt động.

## Catalog demo bakery

`Bánh Mây Atelier` có 12 sản phẩm, 24 biến thể và năm nhóm: bánh sinh nhật, mousse, bánh mì thủ công, pastry, cookies/quà tặng.

Mỗi record có giá, khẩu phần, dị nguyên, hạn dùng, tồn kho và mô tả tư vấn. Seed archive catalog thời trang demo cũ, không xóa dữ liệu.

```powershell
pnpm.cmd seed:bakery-demo
```

Script chạy lặp lại an toàn theo slug/SKU. Chỉ dùng catalog demo để test; thay bằng dữ liệu shop được duyệt trước khi public.

## Sales playbook

- Bot xưng `em`, gọi khách chưa rõ danh xưng là `anh/chị`.
- Khám phá một nhu cầu tại một thời điểm, tư vấn tối đa ba lựa chọn.
- Giá/tồn/giao hàng/chính sách phải gọi tool trước khi trả lời.
- Phản đối: đồng cảm, lợi ích có căn cứ, rồi câu hỏi nhẹ nhàng.
- Checkout: xác nhận sản phẩm, sau đó thu tên, điện thoại, địa chỉ và thanh toán lần lượt.
- Chỉ handover khi khách yêu cầu người thật hoặc cần thao tác nhân viên.

## Control mode

| Mode     | Hành vi                      |
| -------- | ---------------------------- |
| `ai`     | Agent có thể trả lời tự động |
| `human`  | Chỉ nhân viên trả lời        |
| `paused` | Tạm dừng tự động hóa         |

Control change dùng optimistic version để tránh nhân viên và agent ghi đè nhau.

## Kiểm thử

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
```

`test:integration` cần Postgres/Redis healthy. Dừng API local khi chạy integration test để worker thật không lấy queue job test.

```powershell
pnpm.cmd fixture:send
```

Fixture ký raw payload bằng local app secret. Đổi Meta message ID nếu muốn gửi lại vì ID trùng sẽ bị dedupe.

## Database và giới hạn hiện tại

Migrations trong `packages/db/migrations` là immutable; runner ghi SHA-256 vào `schema_migrations`. Phục hồi production bằng forward migration hoặc restore backup, không sửa migration đã áp dụng.

- Admin UI hiện còn là demo.
- Outbound delivery persistence/retry chuyên biệt chưa hoàn thiện.
- Catalog/FAQ demo phải thay bằng dữ liệu shop thật trước khi public.
- Meta App Review và quyền production phụ thuộc Meta/account của chủ Page.

## Bảo mật

- Không public PostgreSQL hoặc Redis.
- Chỉ expose callback HTTPS.
- Xác thực HMAC trước khi parse JSON.
- Dùng token phạm vi tối thiểu và monitor `/ready`.
