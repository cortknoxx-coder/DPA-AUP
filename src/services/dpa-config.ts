function readMeta(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.querySelector(`meta[name="${name}"]`);
  const v = el?.getAttribute('content')?.trim();
  return v && v.length > 0 ? v : undefined;
}

function isHostedHttps(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';
}

function resolveBridgeUrl(): string | null {
  const override = readMeta('dpa-relay-ws-url') || readMeta('dpa-bridge-ws-url');
  if (override) {
    return override;
  }
  if (isHostedHttps()) {
    return null;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost';
    return `ws://${host}:8787`;
  }
  return 'ws://localhost:8787';
}

function resolveBridgeHttpUrl(): string {
  const override = readMeta('dpa-cloud-control-base') || readMeta('dpa-bridge-http-url');
  if (override) return override.replace(/\/$/, '');
  if (typeof window !== 'undefined' && isHostedHttps()) {
    return `${window.location.origin}/internal-api/device`;
  }
  return 'http://127.0.0.1:8787/bridge';
}

function resolveApiUrl(): string {
  const override = readMeta('dpa-api-base-url');
  if (override) return override;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost';
    if (isHostedHttps()) {
      return `${window.location.origin}/api/v1`;
    }
    return `http://${host}:8080/api/v1`;
  }
  return 'http://localhost:8080/api/v1';
}

export const DPA_CONFIG = {
  get bridgeWsUrl() { return resolveBridgeUrl(); },
  get bridgeHttpUrl() { return resolveBridgeHttpUrl(); },
  get apiBaseUrl() { return resolveApiUrl(); },
};
