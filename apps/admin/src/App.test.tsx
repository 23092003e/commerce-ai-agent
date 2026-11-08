// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('keeps the secret out of storage, clears it after login and sends CSRF on mutations', async () => {
  const store = vi.fn();
  vi.stubGlobal('localStorage', { setItem: store, removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { setItem: store, removeItem: vi.fn() });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/session'))
      return new Response(
        JSON.stringify(
          init?.method === 'POST' ? { csrfToken: 'csrf-value' } : {}
        ),
        { status: init?.method === 'POST' ? 200 : 401 }
      );
    if (url.endsWith('/control')) return new Response('{}', { status: 409 });
    return new Response(
      JSON.stringify({
        conversations: [
          {
            id: 'conversation-id',
            customer: 'Test customer',
            controlMode: 'ai',
            lastMessage: 'Hi',
            version: 1
          }
        ],
        orders: [],
        products: [],
        customers: [],
        documents: [],
        runs: [],
        handovers: [],
        carts: [],
        messages: []
      })
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  fireEvent.change(screen.getByLabelText('Admin secret'), {
    target: { value: 'private-login-secret' }
  });
  fireEvent.click(screen.getByText('Connect'));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('Admin secret').value).toBe(
      ''
    )
  );
  await waitFor(() => expect(screen.getByText('Take over')).toBeTruthy());
  fireEvent.click(screen.getByText('Take over'));
  await waitFor(() => expect(screen.getByText(/Refresh first/)).toBeTruthy());
  expect(store).not.toHaveBeenCalled();
  const login = fetcher.mock.calls.find(
    ([, init]) =>
      typeof init?.body === 'string' &&
      init.body.includes('private-login-secret')
  );
  expect(login?.[0]).toBe('/internal/admin/session');
  const mutation = fetcher.mock.calls.find(([url]) => url.endsWith('/control'));
  expect(mutation?.[1]?.headers).toMatchObject({
    'X-CSRF-Token': 'csrf-value'
  });
  expect(mutation?.[1]?.credentials).toBe('same-origin');
  expect(
    fetcher.mock.calls
      .filter(([url]) => !url.endsWith('/session'))
      .every(
        ([, init]) => !JSON.stringify(init).includes('private-login-secret')
      )
  ).toBe(true);
});
