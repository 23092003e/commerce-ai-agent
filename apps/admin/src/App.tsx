import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './App.css';

interface Conversation {
  id: string;
  customer: string | null;
  controlMode: 'ai' | 'human' | 'paused';
  lastMessage: string | null;
  version: number;
}
interface ConversationMessage {
  id: string;
  senderType: string;
  text: string | null;
  deliveryState: string;
  createdAt: string;
}
interface Order {
  id: string;
  orderNumber: string;
  customer: string | null;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
}
interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  recipientName: string;
  paymentMethod: string;
  paymentStatus: string;
  total: string;
  currency: string;
  items: Array<{
    sku: string;
    name: string;
    variant: string;
    quantity: number;
    lineTotal: string;
  }>;
}
interface Product {
  id: string;
  name: string;
  sku: string | null;
  status: string;
  price: string;
  currency: string;
  variantCount: number;
  availableInventory: number;
}
interface ProductDetail {
  id: string;
  name: string;
  status: string;
  currency: string;
  description: string;
  variants: Array<{
    sku: string;
    title: string;
    status: string;
    price: string;
    availableInventory: number;
  }>;
}
interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  conversationCount: number;
}
interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  topics: string[];
  updatedAt: string;
}
interface AgentRun {
  id: string;
  conversationId: string;
  customer: string | null;
  model: string;
  status: string;
  outcome: string | null;
  latencyMs: number | null;
  toolCallCount: number;
  startedAt: string;
}
type View =
  'inbox' | 'customers' | 'products' | 'orders' | 'knowledge' | 'traces';

const configuredApiUrl: unknown = import.meta.env.VITE_API_URL;
const apiUrl =
  typeof configuredApiUrl === 'string' && configuredApiUrl.length > 0
    ? configuredApiUrl
    : 'http://127.0.0.1:3000';

function hasArray(
  value: unknown,
  key: string
): value is Record<string, unknown[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)[key])
  );
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function formatMoney(total: string, currency: string): string {
  const amount = Number(total);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
        amount
      )
    : `${total} ${currency}`;
}
function isOrderDetail(value: unknown): value is { order: OrderDetail } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'order' in value &&
    typeof value.order === 'object' &&
    value.order !== null
  );
}
function isProductDetail(value: unknown): value is { product: ProductDetail } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'product' in value &&
    typeof value.product === 'object' &&
    value.product !== null
  );
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem('admin-token') ?? ''
  );
  const [view, setView] = useState<View>('inbox');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productDetail, setProductDetail] = useState<ProductDetail | null>(
    null
  );
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [knowledgeTopics, setKnowledgeTopics] = useState('');
  const [status, setStatus] = useState('Enter the admin token to connect.');

  async function fetchList<T>(path: string, key: string): Promise<T[]> {
    const response = await fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (response.status === 401) throw new Error('Invalid admin token.');
    if (!response.ok) throw new Error(`Could not load ${key}.`);
    const data: unknown = await response.json();
    if (!hasArray(data, key))
      throw new Error(`Admin API returned invalid ${key}.`);
    return data[key] as T[];
  }
  async function load() {
    localStorage.setItem('admin-token', token);
    try {
      const [
        nextConversations,
        nextOrders,
        nextProducts,
        nextCustomers,
        nextDocuments,
        nextRuns
      ] = await Promise.all([
        fetchList<Conversation>(
          '/internal/admin/conversations',
          'conversations'
        ),
        fetchList<Order>('/internal/admin/orders', 'orders'),
        fetchList<Product>('/internal/admin/products', 'products'),
        fetchList<Customer>('/internal/admin/customers', 'customers'),
        fetchList<KnowledgeDocument>('/internal/admin/knowledge', 'documents'),
        fetchList<AgentRun>('/internal/admin/agent-runs', 'runs')
      ]);
      setConversations(nextConversations);
      setOrders(nextOrders);
      setProducts(nextProducts);
      setCustomers(nextCustomers);
      setDocuments(nextDocuments);
      setRuns(nextRuns);
      const firstConversation = nextConversations.at(0) ?? null;
      setSelected(
        (current) =>
          nextConversations.find((item) => item.id === current?.id) ??
          firstConversation
      );
      setStatus(`${String(nextConversations.length)} conversations loaded.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not load admin data.'
      );
    }
  }
  async function setMode(controlMode: Conversation['controlMode']) {
    if (!selected) return;
    const response = await fetch(
      `${apiUrl}/internal/admin/conversations/${selected.id}/control`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ expectedVersion: selected.version, controlMode })
      }
    );
    if (!response.ok) {
      setStatus(
        response.status === 409
          ? 'Conversation changed elsewhere. Refresh first.'
          : 'Control update failed.'
      );
      return;
    }
    await load();
  }
  async function ingestKnowledge() {
    const response = await fetch(`${apiUrl}/internal/admin/knowledge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: knowledgeTitle,
        sourceType: 'policy',
        content: knowledgeContent,
        topics: knowledgeTopics
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      })
    });
    if (!response.ok) {
      setStatus(
        response.status === 401
          ? 'Invalid admin token.'
          : 'Knowledge update failed.'
      );
      return;
    }
    const result: unknown = await response.json();
    setStatus(
      `Knowledge ${JSON.stringify(result).includes('created') ? 're-indexed' : 'already indexed'}.`
    );
    setKnowledgeContent('');
    await load();
  }
  async function loadOrderDetail(orderId: string) {
    const response = await fetch(`${apiUrl}/internal/admin/orders/${orderId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      setStatus('Could not load order detail.');
      return;
    }
    const data: unknown = await response.json();
    if (!isOrderDetail(data)) {
      setStatus('Admin API returned invalid order detail.');
      return;
    }
    setOrderDetail(data.order);
  }
  async function loadProductDetail(productId: string) {
    const response = await fetch(
      `${apiUrl}/internal/admin/products/${productId}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      setStatus('Could not load product detail.');
      return;
    }
    const data: unknown = await response.json();
    if (!isProductDetail(data)) {
      setStatus('Admin API returned invalid product detail.');
      return;
    }
    setProductDetail(data.product);
  }
  useEffect(() => {
    if (token) void load();
  }, []);
  useEffect(() => {
    if (!token || !selected) {
      setMessages([]);
      return;
    }
    void fetchList<ConversationMessage>(
      `/internal/admin/conversations/${selected.id}/messages`,
      'messages'
    )
      .then(setMessages)
      .catch((error: unknown) =>
        setStatus(
          error instanceof Error ? error.message : 'Could not load messages.'
        )
      );
  }, [selected?.id]);
  const navigation: Array<{ id: View; label: string }> = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'customers', label: 'Customers' },
    { id: 'products', label: 'Products' },
    { id: 'orders', label: 'Orders' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'traces', label: 'Agent traces' }
  ];

  return (
    <main className="ops-shell">
      <aside className="rail">
        <strong>
          MONEXIS
          <br />
          <i>OPERATIONS</i>
        </strong>
        <nav aria-label="Operations navigation">
          {navigation.map((item) => (
            <button
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <small>
          Facebook sales desk
          <br />
          v1 operator console
        </small>
      </aside>
      <section className="desk">
        <header>
          <div>
            <span>LIVE OPERATIONS</span>
            <h1>{navigation.find((item) => item.id === view)?.label}</h1>
          </div>
          <button onClick={() => void load()}>Refresh</button>
        </header>
        <div className="auth">
          <input
            aria-label="Admin token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Admin bearer token"
          />
          <button onClick={() => void load()}>Connect</button>
          <em>{status}</em>
        </div>
        {view === 'inbox' && (
          <div className="workspace">
            <div className="inbox">
              <h2>
                Open conversations <b>{conversations.length}</b>
              </h2>
              {conversations.map((item) => (
                <button
                  className={
                    selected?.id === item.id
                      ? 'conversation active'
                      : 'conversation'
                  }
                  key={item.id}
                  onClick={() => setSelected(item)}
                >
                  <span>{item.customer ?? 'Unknown customer'}</span>
                  <mark>{item.controlMode}</mark>
                  <p>{item.lastMessage ?? 'No messages yet'}</p>
                </button>
              ))}
            </div>
            <div className="detail">
              {selected ? (
                <>
                  <span>CONVERSATION {selected.id.slice(0, 8)}</span>
                  <h2>
                    {selected.customer ?? 'Unknown customer'}{' '}
                    <mark>{selected.controlMode}</mark>
                  </h2>
                  <article className="timeline">
                    <h3>Conversation timeline</h3>
                    {messages.length > 0 ? (
                      messages.map((message) => (
                        <div
                          className={
                            message.senderType === 'customer'
                              ? 'message customer'
                              : 'message'
                          }
                          key={message.id}
                        >
                          <small>
                            {message.senderType} ·{' '}
                            {formatDate(message.createdAt)}
                          </small>
                          <p>{message.text ?? 'Attachment or event'}</p>
                        </div>
                      ))
                    ) : (
                      <p>
                        {selected.lastMessage ??
                          'No customer message has been recorded.'}
                      </p>
                    )}
                    <p>
                      Version {selected.version}. Actions are concurrency-safe.
                    </p>
                  </article>
                  <div className="actions">
                    <button onClick={() => void setMode('human')}>
                      Take over
                    </button>
                    <button onClick={() => void setMode('ai')}>
                      Return to AI
                    </button>
                    <button onClick={() => void setMode('paused')}>
                      Pause
                    </button>
                  </div>
                </>
              ) : (
                <p>No conversations yet.</p>
              )}
            </div>
          </div>
        )}
        {view === 'orders' && (
          <>
            <DataTable
              title="Recent confirmed and pending orders"
              headers={['Order', 'Customer', 'Status', 'Total', 'Created']}
              rows={orders.map((item) => [
                <button
                  className="table-button"
                  onClick={() => void loadOrderDetail(item.id)}
                >
                  {item.orderNumber}
                </button>,
                item.customer ?? 'Unknown',
                <mark>{item.status}</mark>,
                formatMoney(item.total, item.currency),
                formatDate(item.createdAt)
              ])}
              empty="No orders yet."
            />
            {orderDetail && (
              <section className="order-detail">
                <h2>
                  {orderDetail.orderNumber} <mark>{orderDetail.status}</mark>
                </h2>
                <p>
                  {orderDetail.recipientName} · {orderDetail.paymentMethod} ·{' '}
                  {orderDetail.paymentStatus}
                </p>
                <ul>
                  {orderDetail.items.map((item) => (
                    <li key={`${item.sku}-${item.variant}`}>
                      {item.name} ({item.variant}) × {item.quantity} —{' '}
                      {formatMoney(item.lineTotal, orderDetail.currency)}
                    </li>
                  ))}
                </ul>
                <strong>
                  Total: {formatMoney(orderDetail.total, orderDetail.currency)}
                </strong>
              </section>
            )}
          </>
        )}
        {view === 'products' && (
          <>
            <DataTable
              title="Products, variants and available inventory"
              headers={[
                'Product',
                'SKU',
                'Status',
                'Price',
                'Variants',
                'Available'
              ]}
              rows={products.map((item) => [
                <button
                  className="table-button"
                  onClick={() => void loadProductDetail(item.id)}
                >
                  {item.name}
                </button>,
                item.sku ?? '—',
                <mark>{item.status}</mark>,
                formatMoney(item.price, item.currency),
                item.variantCount,
                item.availableInventory
              ])}
              empty="No products yet."
            />
            {productDetail && (
              <section className="order-detail">
                <h2>
                  {productDetail.name} <mark>{productDetail.status}</mark>
                </h2>
                <p>{productDetail.description}</p>
                <ul>
                  {productDetail.variants.map((variant) => (
                    <li key={variant.sku}>
                      {variant.sku} · {variant.title} · {variant.status} ·{' '}
                      {formatMoney(variant.price, productDetail.currency)} ·{' '}
                      {variant.availableInventory} available
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {view === 'customers' && (
          <DataTable
            title="Customers"
            headers={['Name', 'Phone', 'Email', 'Conversations']}
            rows={customers.map((item) => [
              item.name ?? 'Unknown',
              item.phone ?? '—',
              item.email ?? '—',
              item.conversationCount
            ])}
            empty="No customers yet."
          />
        )}
        {view === 'knowledge' && (
          <>
            <section className="knowledge-form">
              <h2>Index or replace a policy</h2>
              <p>
                Re-indexing the same title archives its active prior version
                after the new content is safely stored.
              </p>
              <input
                value={knowledgeTitle}
                onChange={(event) => setKnowledgeTitle(event.target.value)}
                placeholder="Document title"
              />
              <input
                value={knowledgeTopics}
                onChange={(event) => setKnowledgeTopics(event.target.value)}
                placeholder="Topics, comma separated"
              />
              <textarea
                value={knowledgeContent}
                onChange={(event) => setKnowledgeContent(event.target.value)}
                placeholder="Paste policy, FAQ, guide, or sales script content"
                rows={7}
              />
              <button onClick={() => void ingestKnowledge()}>
                Index knowledge
              </button>
            </section>
            <DataTable
              title="Knowledge sources"
              headers={['Document', 'Type', 'Topics', 'Status', 'Updated']}
              rows={documents.map((item) => [
                item.title,
                item.sourceType,
                item.topics.join(', ') || '—',
                <mark>{item.status}</mark>,
                formatDate(item.updatedAt)
              ])}
              empty="No knowledge documents yet."
            />
          </>
        )}
        {view === 'traces' && (
          <DataTable
            title="Latest agent runs"
            headers={[
              'Customer',
              'Model',
              'Status',
              'Outcome',
              'Latency',
              'Tools',
              'Started'
            ]}
            rows={runs.map((item) => [
              item.customer ?? 'Unknown',
              item.model,
              <mark>{item.status}</mark>,
              item.outcome ?? '—',
              item.latencyMs === null ? '—' : `${String(item.latencyMs)} ms`,
              item.toolCallCount,
              formatDate(item.startedAt)
            ])}
            empty="No agent runs yet."
          />
        )}
      </section>
    </main>
  );
}

function DataTable({
  title,
  headers,
  rows,
  empty
}: {
  title: string;
  headers: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
}) {
  return (
    <section className="table-panel">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(rowIndex)}>
              {row.map((cell, cellIndex) => (
                <td key={String(cellIndex)}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">{empty}</p>}
    </section>
  );
}
