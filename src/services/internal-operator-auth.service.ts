import { Injectable, computed, signal } from '@angular/core';
import { dpaInternalApiBaseUrl } from '../dpa-internal-api-base';

export interface InternalOperatorSession {
  authenticated: boolean;
  expiresAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class InternalOperatorAuthService {
  private sessionSignal = signal<InternalOperatorSession | null>(null);
  private stateSignal = signal<'loading' | 'authenticated' | 'anonymous' | 'error'>('loading');

  session = computed(() => this.sessionSignal());
  state = computed(() => this.stateSignal());
  isAuthenticated = computed(() => this.sessionSignal()?.authenticated === true);
  get apiBase(): string | null {
    return dpaInternalApiBaseUrl();
  }

  constructor() {
    void this.refreshSession();
  }

  async refreshSession(): Promise<boolean> {
    this.stateSignal.set('loading');
    if (!this.apiBase) {
      this.sessionSignal.set(null);
      this.stateSignal.set('anonymous');
      return false;
    }
    try {
      const response = await fetch(`${this.apiBase}/auth/session`, {
        credentials: 'include',
      });
      const payload = await response.json();
      const session = {
        authenticated: !!payload.authenticated,
        expiresAt: payload.expiresAt || null,
      } satisfies InternalOperatorSession;
      this.sessionSignal.set(session);
      this.stateSignal.set(session.authenticated ? 'authenticated' : 'anonymous');
      return session.authenticated;
    } catch (error) {
      console.error('[InternalAuth] Failed to refresh operator session', error);
      this.sessionSignal.set(null);
      this.stateSignal.set('error');
      return false;
    }
  }

  async login(passphrase: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiBase) {
      this.stateSignal.set('anonymous');
      return { ok: false, error: 'The internal auth service is not configured for this hosted portal.' };
    }
    try {
      const response = await fetch(`${this.apiBase}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passphrase }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        this.stateSignal.set('anonymous');
        return { ok: false, error: payload.error || 'Operator login failed.' };
      }
      this.sessionSignal.set({
        authenticated: true,
        expiresAt: payload.expiresAt || null,
      });
      this.stateSignal.set('authenticated');
      return { ok: true };
    } catch (error) {
      console.error('[InternalAuth] Login failed', error);
      this.stateSignal.set('error');
      return { ok: false, error: 'The internal auth service is unavailable.' };
    }
  }

  async logout(): Promise<void> {
    if (!this.apiBase) {
      this.sessionSignal.set({
        authenticated: false,
        expiresAt: null,
      });
      this.stateSignal.set('anonymous');
      return;
    }
    try {
      await fetch(`${this.apiBase}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // best effort
    } finally {
      this.sessionSignal.set({
        authenticated: false,
        expiresAt: null,
      });
      this.stateSignal.set('anonymous');
    }
  }
}
