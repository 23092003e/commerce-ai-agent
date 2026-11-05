export async function adminRequest(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  return fetch(input, { ...init, credentials: 'same-origin' });
}
