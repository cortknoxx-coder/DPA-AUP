
function resolveBridgeUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost';
    return `ws://${host}:8787`;
  }
  return 'ws://localhost:8787';
}

function resolveApiUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:8080/api/v1`;
  }
  return 'http://localhost:8080/api/v1';
}

export const DPA_CONFIG = {
  get bridgeWsUrl() { return resolveBridgeUrl(); },
  get apiBaseUrl() { return resolveApiUrl(); },
};
