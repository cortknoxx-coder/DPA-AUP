import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BrandMarkComponent } from '../../components/brand-mark/brand-mark.component';
import { InternalOperatorAuthService } from '../../services/internal-operator-auth.service';

@Component({
  selector: 'app-internal-login',
  standalone: true,
  imports: [CommonModule, FormsModule, BrandMarkComponent],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8">
      <div class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-black/30">
        <app-brand-mark tone="teal" size="compact" suffix="INTERNAL"></app-brand-mark>
        <h1 class="mt-6 text-2xl font-bold tracking-tight text-slate-50">Operator Access</h1>
        <p class="mt-3 text-sm leading-6 text-slate-400">
          Private DPAC ingest is isolated behind a separate operator session. This surface is not linked from creator or fan navigation.
        </p>

        <label class="mt-6 block">
          <div class="text-[11px] uppercase tracking-[0.22em] text-slate-500">Operator Passphrase</div>
          <input
            [(ngModel)]="passphrase"
            type="password"
            autocomplete="current-password"
            class="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
            (keydown.enter)="login()"
          >
        </label>

        @if (message()) {
          <div class="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {{ message() }}
          </div>
        }

        <div class="mt-6 flex gap-3">
          <button
            type="button"
            (click)="login()"
            [disabled]="submitting()"
            class="flex-1 rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ submitting() ? 'Signing In...' : 'Enter Internal Surface' }}
          </button>
          <button
            type="button"
            (click)="router.navigateByUrl('/login')"
            class="rounded-full border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500"
          >
            Exit
          </button>
        </div>

        <div class="mt-6 text-xs text-slate-500">
          API state: {{ auth.state() }}
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
