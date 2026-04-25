import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InternalOperatorAuthService } from '../../services/internal-operator-auth.service';

@Component({
  selector: 'app-internal-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex min-h-screen items-center justify-center px-4 py-8 relative overflow-hidden" style="background: var(--bg-canvas);">
      <div class="absolute -top-1/3 -left-1/4 w-1/2 h-1/2 rounded-full blur-3xl pointer-events-none" style="background: var(--accent-glow); opacity: 0.12;"></div>
      <div class="absolute -bottom-1/3 -right-1/4 w-1/2 h-1/2 rounded-full blur-3xl pointer-events-none" style="background: rgba(99,102,241,0.12);"></div>

      <div class="w-full max-w-md surface p-8 anim-fade-up z-10" style="box-shadow: var(--shadow-2xl);">
        <div class="flex items-center gap-2">
          <span class="h-1.5 w-1.5 rounded-full animate-pulse" style="background: var(--warning);"></span>
          <span class="eyebrow" style="color: var(--warning);">DPA / Internal</span>
        </div>
        <h1 class="h-display-3 mt-2">Operator Access</h1>
        <p class="mt-3 text-sm leading-6 text-fg-muted">
          Private DPAC ingest is isolated behind a separate operator session. This surface is not linked from creator or fan navigation.
        </p>

        <label class="mt-6 block">
          <div class="stat-label">Operator Passphrase</div>
          <input
            [(ngModel)]="passphrase"
            type="password"
            autocomplete="current-password"
            class="mt-2 w-full rounded-xl px-4 py-3 text-sm text-fg-strong outline-none transition-colors font-mono"
            style="background: var(--bg-base); border: 1px solid var(--border-subtle);"
            (keydown.enter)="login()"
          >
        </label>

        @if (message()) {
          <div class="mt-4 rounded-xl px-4 py-3 text-sm" style="background: var(--danger-soft); border: 1px solid rgba(248,113,113,0.3); color: var(--danger);">
            {{ message() }}
          </div>
        }

        <div class="mt-6 flex gap-3">
          <button
            type="button"
            (click)="login()"
            [disabled]="submitting()"
            class="btn btn-accent flex-1 btn-lg"
          >
            {{ submitting() ? 'Signing in…' : 'Enter Internal Surface' }}
          </button>
          <button
            type="button"
            (click)="router.navigateByUrl('/login')"
            class="btn btn-ghost btn-lg"
          >
            Exit
          </button>
        </div>

        <div class="mt-6 text-xs text-fg-faint font-mono">
          api_state: {{ auth.state() }}
        </div>
      </div>
    </div>
  `,
})
export class InternalLoginComponent {
  auth = inject(InternalOperatorAuthService);
  router = inject(Router);

  passphrase = '';
  message = signal('');
  submitting = signal(false);

  async login() {
    if (!this.passphrase.trim()) {
      this.message.set('Enter the operator passphrase to access private ingest.');
      return;
    }
    this.submitting.set(true);
    this.message.set('');
    const result = await this.auth.login(this.passphrase);
    this.submitting.set(false);
    if (!result.ok) {
      this.message.set(result.error || 'Operator login failed.');
      return;
    }
    await this.router.navigateByUrl('/internal/ingest');
  }
}
