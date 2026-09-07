import { useEffect, useState } from 'react';
import './App.css';

interface Conversation {
  id: string;
  customer: string | null;
  controlMode: 'ai' | 'human' | 'paused';
  lastMessage: string | null;
  version: number;
}
const apiUrl = 'http://127.0.0.1:3000';

function isConversationList(
  value: unknown
): value is { conversations: Conversation[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { conversations?: unknown }).conversations)
  );
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem('admin-token') ?? ''
  );
  const [items, setItems] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [status, setStatus] = useState('Enter the admin token to connect.');
  async function load() {
    localStorage.setItem('admin-token', token);
    const response = await fetch(`${apiUrl}/internal/admin/conversations`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok)
      return setStatus(
        response.status === 401
          ? 'Invalid admin token.'
          : 'Could not load conversations.'
      );
    const data: unknown = await response.json();
    if (!isConversationList(data))
      return setStatus('Admin API returned invalid data.');
    setItems(data.conversations);
    setSelected(
      (current) =>
        data.conversations.find((item) => item.id === current?.id) ??
        data.conversations[0]
    );
    setStatus(`${String(data.conversations.length)} conversations loaded.`);
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
    if (!response.ok)
      return setStatus(
        response.status === 409
          ? 'Conversation changed elsewhere. Refresh first.'
          : 'Control update failed.'
      );
    await load();
  }
  useEffect(() => {
    if (token) void load();
  }, []);
  return (
    <main className="ops-shell">
      <aside className="rail">
        <strong>
          MONEXIS
          <br />
          <i>OPERATIONS</i>
        </strong>
        <nav>
          Inbox
          <br />
          Customers
          <br />
          Orders
          <br />
          Knowledge
          <br />
          Agent traces
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
            <h1>Conversation desk</h1>
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
        <div className="workspace">
          <div className="inbox">
            <h2>
              Open conversations <b>{items.length}</b>
            </h2>
            {items.map((item) => (
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
                <article>
                  <h3>Latest customer context</h3>
                  <p>
                    {selected.lastMessage ??
                      'No customer message has been recorded.'}
                  </p>
                  <p>
                    Version {selected.version} · actions are concurrency-safe.
                  </p>
                </article>
                <div className="actions">
                  <button onClick={() => void setMode('human')}>
                    Take over
                  </button>
                  <button onClick={() => void setMode('ai')}>
                    Return to AI
                  </button>
                  <button onClick={() => void setMode('paused')}>Pause</button>
                </div>
              </>
            ) : (
              <p>No conversations yet.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
