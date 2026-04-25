import { CommonModule, DatePipe } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PrivateIngestItem, PrivateIngestService } from '../../services/private-ingest.service';
import { InternalOperatorAuthService } from '../../services/internal-operator-auth.service';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-internal-ingest',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header class="surface p-6 sm:p-8 anim-fade-up">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="h-1.5 w-1.5 rounded-full animate-pulse" style="background: var(--warning);"></span>
              <span class="eyebrow" style="color: var(--warning);">DPA / Internal</span>
            </div>
            <h1 class="h-display-2 mt-2">Private DPAC Ingest</h1>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-fg-muted">
              Operator-only ingest surface backed by a private API and filesystem storage. Raw drops stay outside creator and fan portal flows.
            </p>
            <div class="mt-3 chip chip-warning">
              Device-push runs over STA connectivity. Keep this surface unlinked from creator and fan navigation.
            </div>
          </div>
          <div class="flex flex-wrap gap-3 items-center">
            <div class="surface-strong px-3 py-2 text-xs text-fg-muted">
              Enter via <span class="font-mono text-fg-strong">#/internal/login</span>
            </div>
            <button
              type="button"
              (click)="logout()"
              class="btn btn-ghost"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <section class="grid gap-3 md:grid-cols-4 anim-stagger">
        <div class="stat"><div class="stat-label">State</div><div class="stat-value">{{ ingest.state() | uppercase }}</div></div>
        <div class="stat"><div class="stat-label">Staged</div><div class="stat-value">{{ ingest.stagedCount() }}</div></div>
        <div class="stat"><div class="stat-label">Verified</div><div class="stat-value" style="color: var(--success);">{{ ingest.verifiedCount() }}</div></div>
        <div class="stat"><div class="stat-label">Registered Devices</div><div class="stat-value" style="color: var(--accent);">{{ ingest.devices().length }}</div></div>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div class="space-y-6">
          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Operator Session</div>
                <h2 class="mt-2 text-xl font-semibold text-slate-50">Control plane + device bridge</h2>
              </div>
              <div class="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
                Auth {{ auth.state() }}
              </div>
            </div>

            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">API Base</div>
                <div class="mt-2 break-all text-sm text-slate-200">{{ auth.apiBase }}</div>
              </div>
              <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Connected DPA</div>
                <div class="mt-2 text-sm text-slate-200">
                  @if (connectionService.connectionStatus() === 'wifi') {
                    {{ connectionService.deviceInfo()?.serial || 'WiFi connected' }}
                  } @else {
                    No live device connection
                  }
                </div>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                (click)="detectDevice()"
                class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
              >
                Detect Device
              </button>
              <button
                type="button"
                (click)="connectWifi()"
                class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
              >
                Connect WiFi Direct
              </button>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Device Provisioning</div>
                <h2 class="mt-2 text-xl font-semibold text-slate-50">Register and provision a DPA</h2>
              </div>
              <div class="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
                {{ ingest.devices().length }} device(s)
              </div>
            </div>

            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <label class="block">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Device ID</div>
                <input
                  [(ngModel)]="deviceId"
                  type="text"
                  placeholder="DPA-UNIT-001"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
              </label>
              <label class="block">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Album ID</div>
                <input
                  [(ngModel)]="albumId"
                  type="text"
                  placeholder="ALB-8A8-2025-0001"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
              </label>
              <label class="block sm:col-span-2">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Ingest Server URL For Device STA Upload</div>
                <input
                  [(ngModel)]="provisionBaseUrl"
                  type="text"
                  placeholder="http://192.168.1.12:8787"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
              </label>
            </div>

            <div class="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                (click)="registerDevice()"
                class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
              >
                Register Device Token
              </button>
              <button
                type="button"
                (click)="provisionConnectedDevice()"
                [disabled]="!issuedDeviceToken() || connectionService.connectionStatus() !== 'wifi'"
                class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Provision Connected DPA
              </button>
              <button
                type="button"
                (click)="clearProvisioning()"
                [disabled]="connectionService.connectionStatus() !== 'wifi'"
                class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear Device Ingest Config
              </button>
            </div>

            @if (issuedDeviceToken()) {
              <div class="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Issued Device Token</div>
                <div class="mt-2 break-all font-mono text-xs text-slate-200">{{ issuedDeviceToken() }}</div>
              </div>
            }

            <div class="mt-5 space-y-3">
              @for (device of ingest.devices(); track device.id) {
                <div class="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div class="text-sm font-semibold text-slate-100">{{ device.deviceId }}</div>
                      <div class="mt-1 text-xs text-slate-500">
                        Album {{ device.albumId || 'UNASSIGNED' }} · Last seen {{ device.lastSeenAt ? (device.lastSeenAt | date:'medium') : 'never' }}
                      </div>
                    </div>
                    <button
                      type="button"
                      (click)="applyDevice(device.deviceId, device.albumId)"
                      class="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
                    >
                      Use In Form
                    </button>
                  </div>
                </div>
              } @empty {
                <div class="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                  No registered devices yet. Register one to mint a device-bound token.
                </div>
              }
            </div>
          </div>

          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Device Push</div>
                <h2 class="mt-2 text-xl font-semibold text-slate-50">Push an SD file into private ingest</h2>
              </div>
              <div class="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
                {{ connectionService.connectionStatus() === 'wifi' ? 'DPA online' : 'device offline' }}
              </div>
            </div>

            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <label class="block sm:col-span-2">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">SD Path On Device</div>
                <input
                  [(ngModel)]="pushPath"
                  type="text"
                  placeholder="/tracks/demo.dpa"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
              </label>
              <label class="block">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Album ID</div>
                <input
                  [(ngModel)]="pushAlbumId"
                  type="text"
                  placeholder="ALB-8A8-2025-0001"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
              </label>
              <label class="block">
                <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Kind</div>
                <select
                  [(ngModel)]="pushKind"
                  class="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-teal-500"
                >
                  <option value="audio">audio</option>
                  <option value="art">art</option>
                  <option value="manifest">manifest</option>
                  <option value="capsule">capsule</option>
                  <option value="support">support</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              (click)="pushFromDevice()"
              [disabled]="connectionService.connectionStatus() !== 'wifi'"
              class="mt-5 rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-xs font-semibold text-teal-300 transition-colors hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Push File From Connected DPA
            </button>

            @if (connectionService.wifi.lastStatus()?.ingestState) {
              <div class="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
                Device ingest status:
                <span class="ml-2 font-semibold text-slate-100">{{ connectionService.wifi.lastStatus()?.ingestState }}</span>
                @if (connectionService.wifi.lastStatus()?.ingestLastError) {
                  <span class="ml-2 text-rose-300">({{ connectionService.wifi.lastStatus()?.ingestLastError }})</span>
                }
              </div>
            }
          </div>
        </div>

        <div class="space-y-6">
          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Drop Intake</div>
              <h2 class="mt-2 text-xl font-semibold text-slate-50">Stage incoming DPAC files</h2>
            </div>
            <button
              type="button"
              (click)="filePicker?.nativeElement.click()"
              class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
            >
              Browse Files
            </button>
          </div>

          <div class="mt-5 text-xs text-slate-500">
            Files staged here are written to the private ingest API storage, not to browser local state.
          </div>

          <div
            (drop)="handleDrop($event)"
            (dragover)="handleDragOver($event)"
            (dragleave)="isDragging.set(false)"
            class="mt-5 rounded-3xl border border-dashed p-8 text-center transition-colors"
            [class.border-teal-500]="isDragging()"
            [class.bg-teal-500/5]="isDragging()"
            [class.border-slate-700]="!isDragging()"
            [class.bg-slate-950/40]="!isDragging()"
          >
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-teal-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 class="mt-4 text-lg font-semibold text-slate-100">Drop files here</h3>
            <p class="mt-2 text-sm leading-6 text-slate-400">
              Use this operator-only inbox to test the private drop workflow without surfacing raw files to creators or fans.
            </p>
            <p class="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">
              Accepts any package, art, manifest, or support file for staging.
            </p>
          </div>

          <input
            #filePicker
            type="file"
            multiple
            class="hidden"
            (change)="handleFileSelection($event)"
          >

          @if (statusMessage()) {
            <div class="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              {{ statusMessage() }}
            </div>
          }
        </div>

          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Ingest Queue</div>
              <h2 class="mt-2 text-xl font-semibold text-slate-50">Recent staged drops</h2>
            </div>
            <div class="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
              {{ ingest.items().length }} item(s)
            </div>
          </div>

          <div class="mt-5 space-y-3">
            @for (item of ingest.items(); track item.id) {
              <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-slate-100">{{ item.filename }}</div>
                    <div class="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span class="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-400">
                        {{ formatBytes(item.sizeBytes) }}
                      </span>
                      <span class="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-400">
                        {{ item.mimeType || 'unknown' }}
                      </span>
                      <span class="rounded-full px-2.5 py-1"
                        [class.border]="true"
                        [class.border-emerald-500/30]="item.status === 'verified'"
                        [class.bg-emerald-500/10]="item.status === 'verified'"
                        [class.text-emerald-300]="item.status === 'verified'"
                        [class.border-amber-500/30]="item.status === 'staged'"
                        [class.bg-amber-500/10]="item.status === 'staged'"
                        [class.text-amber-300]="item.status === 'staged'"
                        [class.border-slate-700]="item.status === 'archived'"
                        [class.bg-slate-800]="item.status === 'archived'"
                        [class.text-slate-300]="item.status === 'archived'">
                        {{ item.status }}
                      </span>
                    </div>
                    <div class="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <div>Device: <span class="font-mono text-slate-300">{{ item.deviceId }}</span></div>
                      <div>Album: <span class="font-mono text-slate-300">{{ item.albumId }}</span></div>
                      <div>Created: <span class="text-slate-300">{{ item.createdAt | date:'medium' }}</span></div>
                      <div>Updated: <span class="text-slate-300">{{ item.updatedAt | date:'medium' }}</span></div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      (click)="download(item)"
                      class="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-white"
                    >
                      Download
                    </button>
                    @if (item.status !== 'verified') {
                      <button
                        type="button"
                        (click)="updateStatus(item.id, 'verified')"
                        class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-400"
                      >
                        Mark Verified
                      </button>
                    }
                    @if (item.status !== 'archived') {
                      <button
                        type="button"
                        (click)="updateStatus(item.id, 'archived')"
                        class="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500"
                      >
                        Archive
                      </button>
                    }
                    <button
                      type="button"
                      (click)="remove(item.id)"
                      class="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:border-rose-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            } @empty {
              <div class="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
                No staged files yet. Drop a few files into the intake area to test the private flow.
              </div>
            }
          </div>
          </div>

          <div class="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Upload Sessions</div>
                <h2 class="mt-2 text-xl font-semibold text-slate-50">Recent device/operator sessions</h2>
              </div>
              <div class="rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
                {{ ingest.sessions().length }} session(s)
              </div>
            </div>

            <div class="mt-5 space-y-3">
              @for (session of ingest.sessions(); track session.id) {
                <div class="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div class="text-sm font-semibold text-slate-100">{{ session.filename || 'Pending session' }}</div>
                      <div class="mt-1 text-xs text-slate-500">
                        {{ session.source }} · {{ session.status }} · {{ session.deviceId }} · {{ session.albumId }}
                      </div>
                    </div>
                    <div class="text-xs text-slate-500">
                      {{ session.updatedAt | date:'medium' }}
                    </div>
                  </div>
                </div>
              } @empty {
                <div class="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                  No upload sessions have been minted yet.
                </div>
              }
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class InternalIngestComponent {
  auth = inject(InternalOperatorAuthService);
  ingest = inject(PrivateIngestService);
  connectionService = inject(DeviceConnectionService);
  private router = inject(Router);

  @ViewChild('filePicker') filePicker?: ElementRef<HTMLInputElement>;

  isDragging = signal(false);
  statusMessage = signal('');
  deviceId = '';
  albumId = '';
  provisionBaseUrl = '';
  pushPath = '/tracks/';
  pushAlbumId = '';
  pushKind = 'audio';
  issuedDeviceToken = signal('');
  isReady = computed(() => this.ingest.state() === 'ready');

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/internal/login');
  }

  async detectDevice() {
    await this.connectionService.detectConnectedDevice({ silent: false, preferCurrent: true });
  }

  async connectWifi() {
    await this.connectionService.connectViaWifi();
  }

  handleDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  async handleDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    await this.stage(files);
  }

  async handleFileSelection(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    await this.stage(files);
    input.value = '';
  }

  async updateStatus(id: string, status: 'verified' | 'archived') {
    await this.ingest.markStatus(id, status);
    this.statusMessage.set(`Updated ingest item to ${status}.`);
  }

  async registerDevice() {
    if (!this.deviceId.trim()) {
      this.statusMessage.set('Enter a device ID before registering a device token.');
      return;
    }
    const result = await this.ingest.registerDevice({
      deviceId: this.deviceId,
      albumId: this.albumId,
      label: this.deviceId,
    });
    this.issuedDeviceToken.set(result.deviceToken);
    this.pushAlbumId = this.albumId || this.pushAlbumId;
    this.statusMessage.set(`Registered ${result.device.deviceId} and issued a new device token.`);
  }

  async provisionConnectedDevice() {
    if (!this.provisionBaseUrl.trim() || !this.issuedDeviceToken()) {
      this.statusMessage.set('Enter the ingest server URL and register a device token first.');
      return;
    }
    const ok = await this.connectionService.wifi.configurePrivateIngest(
      this.provisionBaseUrl.trim(),
      this.issuedDeviceToken()
    );
    this.statusMessage.set(
      ok
        ? 'Provisioned the connected DPA with the private ingest server URL and device token.'
        : 'Provisioning the connected DPA failed.'
    );
  }

  async clearProvisioning() {
    const ok = await this.connectionService.wifi.clearPrivateIngestConfiguration();
    this.statusMessage.set(ok ? 'Cleared private ingest configuration from the connected DPA.' : 'Could not clear private ingest configuration.');
  }

  async pushFromDevice() {
    if (!this.pushPath.trim()) {
      this.statusMessage.set('Enter an SD file path before triggering a device push.');
      return;
    }
    const result = await this.connectionService.wifi.pushFileToPrivateIngest(
      this.pushPath.trim(),
      this.pushAlbumId.trim() || this.albumId.trim() || 'UNASSIGNED',
      this.pushKind
    );
    await this.ingest.reload();
    this.statusMessage.set(
      result.ok
        ? `Device push completed. Session ${result.lastSessionId || 'created'} is now in the ingest queue.`
        : `Device push failed${result.lastError ? ` (${result.lastError})` : ''}.`
    );
  }

  applyDevice(deviceId: string, albumId: string) {
    this.deviceId = deviceId || this.deviceId;
    this.albumId = albumId || this.albumId;
    this.pushAlbumId = albumId || this.pushAlbumId;
  }

  async remove(id: string) {
    await this.ingest.remove(id);
    this.statusMessage.set('Removed staged file from the private ingest queue.');
  }

  async download(item: PrivateIngestItem) {
    const blob = await this.ingest.getBlob(item.id);
    if (!blob) {
      this.statusMessage.set('That staged file could not be read back from private storage.');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
    this.statusMessage.set(`Downloaded ${item.filename} from the private ingest queue.`);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private async stage(files: File[]) {
    if (!files.length) {
      this.statusMessage.set('No files were selected for the private drop queue.');
      return;
    }

    const result = await this.ingest.stageFiles(files, {
      deviceId: this.deviceId,
      albumId: this.albumId,
    });
    this.statusMessage.set(
      `Staged ${result.count} file(s) in private storage (${this.formatBytes(result.totalBytes)}).`
    );
  }
}
