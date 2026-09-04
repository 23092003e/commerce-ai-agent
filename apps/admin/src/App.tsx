import { useState } from 'react';
import './App.css';
const rows = [
  {
    id: 'C-1042',
    customer: 'Nguyễn Lan',
    state: 'AI',
    note: 'Hỏi áo polo đen, size L'
  },
  {
    id: 'C-1041',
    customer: 'Trần Minh',
    state: 'HUMAN',
    note: 'Yêu cầu tư vấn thanh toán'
  },
  {
    id: 'C-1039',
    customer: 'Lê Anh',
    state: 'HANDOVER',
    note: 'Không đủ evidence chính sách'
  }
];
function App() {
  const [selected, setSelected] = useState(rows[0]);
  const [mode, setMode] = useState(selected.state);
  return (
    <main>
      <aside>
        <b>Fanpage Sales</b>
        <nav>
          Conversations
          <br />
          Customers
          <br />
          Orders
          <br />
          Knowledge
          <br />
          Agent traces
        </nav>
        <small>Admin V1 · protected API</small>
      </aside>
      <section>
        <header>
          <div>
            <small>OPERATIONS</small>
            <h1>Conversation desk</h1>
          </div>
          <button>Refresh</button>
        </header>
        <div className="grid">
          <div className="panel">
            <h2>Open conversations</h2>
            {rows.map((row) => (
              <button
                className="row"
                key={row.id}
                onClick={() => {
                  setSelected(row);
                  setMode(row.state);
                }}
              >
                <b>{row.customer}</b>
                <span>{row.state}</span>
                <p>{row.note}</p>
              </button>
            ))}
          </div>
          <div className="panel">
            <small>{selected.id}</small>
            <h2>
              {selected.customer} <span>{mode}</span>
            </h2>
            <article>
              <h3>Current context</h3>
              <p>{selected.note}</p>
              <p>Cart: 1 item · ₫449,000</p>
              <p>Last action: catalog.searchProducts</p>
            </article>
            <button onClick={() => setMode('HUMAN')}>Take over</button>
            <button className="secondary" onClick={() => setMode('AI')}>
              Return to AI
            </button>
            <p className="hint">
              Actions connect to the protected control API.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
export default App;
