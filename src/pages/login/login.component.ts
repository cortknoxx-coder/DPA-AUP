
import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BrandMarkComponent } from '../../components/brand-mark/brand-mark.component';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, BrandMarkComponent],
  template: `
    <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <!-- Background Effects -->
      <div class="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-teal-900/10 to-transparent pointer-events-none"></div>
      <div class="absolute bottom-0 right-0 w-96 h-96 bg-indigo-900/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="mb-12 text-center z-10">
        <app-brand-mark tone="teal" size="hero" class="justify-center"></app-brand-mark>
        <h1 class="mt-6 text-3xl font-bold text-slate-100 tracking-tight">Welcome to the DPA Ecosystem</h1>
        <p class="text-slate-400 mt-2">Digital Playback Asset Management & Experience</p>
        <div class="mt-4 inline-flex rounded-full border border-slate-800 bg-slate-900/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          Mock License: {{ licenseTier() }}
        </div>
      </div>

      <div class="grid md:grid-cols-2 gap-6 max-w-4xl w-full z-10">
        <!-- Artist / Label Portal -->
        <div
          (click)="login('artist')"
          class="group relative rounded-2xl border border-slate-800 bg-slate-900/50 p-8 hover:bg-slate-900 transition-all hover:border-teal-500/50 hover:shadow-[0_0_30px_rgba(20,184,166,0.1)]"
          [class.cursor-pointer]="creatorPortalEnabled()"
          [class.pointer-events-none]="!creatorPortalEnabled()"
          [class.opacity-60]="!creatorPortalEnabled()">
          <div class="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
          
          <div class="h-12 w-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          
          <h2 class="text-xl font-bold text-slate-100 mb-2">Artist & Label AUP</h2>
          <p class="text-sm text-slate-400 leading-relaxed">
            Manage releases, upload masters, design themes, and push perks (DCNP). The command center for creating Digital Playback Assets.
          </p>
          @if (creatorPortalEnabled()) {
            <div class="mt-6 flex items-center text-xs font-semibold text-teal-400 group-hover:translate-x-1 transition-transform">
              ENTER PORTAL <span class="ml-1">→</span>
            </div>
          } @else {
            <div class="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
              License Required
            </div>
            <p class="mt-2 text-xs leading-5 text-slate-500">
              Creator access is blocked until this account is licensed for creator or dual-role access.
            </p>
          }
        </div>

        <!-- Fan / Owner Portal -->
        <div
          (click)="login('fan')"
          class="group relative rounded-2xl border border-slate-800 bg-slate-900/50 p-8 hover:bg-slate-900 transition-all hover:border-indigo-500/50 hover:shadow-[0_0_30px_rgba(99,102,241,0.1)]"
          [class.cursor-pointer]="fanPortalEnabled()"
          [class.pointer-events-none]="!fanPortalEnabled()"
          [class.opacity-60]="!fanPortalEnabled()">
          <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>

          <div class="h-12 w-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          
          <h2 class="text-xl font-bold text-slate-100 mb-2">Fan & Owner Portal</h2>
          <p class="text-sm text-slate-400 leading-relaxed">
            Connect your DPA™ device, verify ownership via NFC, and access your high-fidelity library. Streaming experience, locally sourced.
          </p>
          @if (fanPortalEnabled()) {
            <div class="mt-6 flex items-center text-xs font-semibold text-indigo-400 group-hover:translate-x-1 transition-transform">
              LAUNCH PLAYER <span class="ml-1">→</span>
            </div>
          } @else {
            <div class="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
              License Required
            </div>
            <p class="mt-2 text-xs leading-5 text-slate-500">
              Fan access is blocked until this account is licensed for fan or dual-role access.
            </p>
          }
        </div>
      </div>
      
      <div class="mt-12 flex items-center gap-3 text-[10px] text-slate-600 font-mono">
        <app-brand-mark tone="slate" size="micro" descriptor="SYSTEM" [framed]="false"></app-brand-mark>
        <span>v2.4.1 • SECURE CONNECTION</span>
      </div>
    </div>
  `
})
export class LoginComponent {
  private userService = inject(UserService);

  creatorPortalEnabled = computed(() => this.userService.canAccessPortal('creator'));
  fanPortalEnabled = computed(() => this.userService.canAccessPortal('fan'));
  licenseTier = this.userService.licenseTier;

  constructor(private router: Router) {}

  login(role: 'artist' | 'fan') {
    if (role === 'artist') {
      if (!this.creatorPortalEnabled()) {
        this.router.navigateByUrl(this.userService.deniedPortalRedirect('creator'));
        return;
      }
      this.router.navigate(['/artist/dashboard']);
    } else {
      if (!this.fanPortalEnabled()) {
        this.router.navigateByUrl(this.userService.deniedPortalRedirect('fan'));
        return;
      }
      this.router.navigate(['/fan']);
    }
  }
}
