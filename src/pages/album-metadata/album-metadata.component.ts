
import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators, FormArray } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { BookletVideo, UnitEconomics } from '../../types';

export type PricingTier = 'entry' | 'premium' | 'collector';

// #############################################################################
// ## METADATA COMPONENT (CORE DETAILS)
// #############################################################################

@Component({
  selector: 'app-album-metadata',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="max-w-4xl space-y-12 pb-20">
      @if (metaDrift()) {
        <div class="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-4">
          <div>
            <div class="font-semibold text-amber-100">Device / portal out of sync</div>
            <div class="mt-0.5 text-amber-300/80 font-mono">
              Device: {{ deviceArtist() || '—' }} / {{ deviceAlbum() || '—' }}
            </div>
          </div>
          <button type="button" (click)="pullFromDevice()" class="shrink-0 rounded bg-amber-600/80 hover:bg-amber-500 text-amber-50 text-xs font-semibold px-3 py-1.5">
            Pull from device
          </button>
        </div>
      }
      <!-- Cover Art -->
      <div class="space-y-4">
        <div class="border-b border-slate-800 pb-2">
          <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Cover Art</h2>
        </div>
        <div class="flex items-start gap-8">
          <div class="relative group shrink-0">
            <div class="w-48 h-48 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950 overflow-hidden flex items-center justify-center"
                 [class.border-solid]="coverArtPreview()"
                 [class.border-slate-600]="coverArtPreview()">
              @if (coverArtPreview()) {
                <img [src]="coverArtPreview()" alt="Cover Art" class="w-full h-full object-cover">
              } @else {
                <div class="text-center p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  <span class="text-xs text-slate-500">No cover art</span>
                </div>
              }
            </div>
            <label class="absolute inset-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-xl flex items-center justify-center">
              <span class="text-xs font-semibold text-white bg-teal-600 px-3 py-1.5 rounded-full">Upload</span>
              <input type="file" accept="image/*" class="hidden" (change)="onCoverArtSelected($event)">
            </label>
          </div>
          <div class="text-xs text-slate-400 space-y-2 pt-2">
            <p class="text-slate-300 font-semibold">Album cover artwork</p>
            <ul class="list-disc list-inside space-y-1 text-slate-500">
              <li><span class="text-slate-300">Size:</span> 3000 x 3000 px (1:1 square)</li>
              <li><span class="text-slate-300">Format:</span> JPG or PNG, max 10 MB</li>
              <li><span class="text-slate-300">Min:</span> 1400 x 1400 px for distribution compliance</li>
              <li><span class="text-slate-300">Tip:</span> Use sRGB color space, no text in the bottom 10%</li>
            </ul>
            <p class="pt-1">Shows on the DPA™ device dashboard, fan portal, marketplace cards, and streaming platforms.</p>
            @if (coverArtPreview()) {
              <button type="button" (click)="removeCoverArt()" class="mt-2 text-rose-400 hover:text-rose-300 text-xs">Remove cover art</button>
            }
            @if (coverArtOnDevice()) {
              <div class="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-700/40 rounded px-2 py-0.5">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                VERIFIED ON DEVICE
              </div>
            }
            @if (coverArtPushStatus()) {
              <div class="mt-2 text-teal-400 text-xs">{{ coverArtPushStatus() }}</div>
            }
            @if (coverArtUploading() || coverArtProgress() > 0) {
              <div class="mt-2">
                <div class="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                  <div class="h-full transition-all duration-150"
                       [class.bg-teal-400]="coverArtUploading()"
                       [class.bg-emerald-400]="!coverArtUploading() && coverArtProgress() === 100"
                       [style.width.%]="coverArtProgress()"></div>
                </div>
                <div class="mt-1 text-[10px] font-mono"
                     [class.text-slate-400]="coverArtUploading()"
                     [class.text-emerald-400]="!coverArtUploading() && coverArtProgress() === 100">
                  @if (coverArtUploading()) {
                    {{ coverArtProgress() }}% · uploading cover to device…
                  } @else if (coverArtProgress() === 100) {
                    100% · ✓ uploaded to device
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
        <!-- Core Identity -->
        <div class="space-y-6">
          <div class="border-b border-slate-800 pb-2">
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Core Identity</h2>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Album Title <span class="text-rose-500">*</span></label>
            <input type="text" formControlName="title" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Main Artist Name <span class="text-rose-500">*</span></label>
            <input type="text" formControlName="artistName" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
            <p class="text-[10px] text-slate-500 mt-1">As it should appear on streaming platforms and the device display.</p>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Release Type</label>
              <select formControlName="releaseType" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
                <option value="album">Album (LP)</option>
                <option value="ep">EP / Mini-Album</option>
                <option value="single">Single</option>
                <option value="compilation">Compilation</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Genre</label>
              <input type="text" formControlName="genre" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="e.g. Pop">
            </div>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Release Date</label>
            <input type="date" formControlName="releaseDate" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none [color-scheme:dark]">
          </div>
        </div>

        <!-- Distribution Rights -->
        <div class="space-y-6">
          <div class="border-b border-slate-800 pb-2">
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Distribution Details</h2>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Record Label</label>
            <input type="text" formControlName="recordLabel" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="e.g. Independent">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">C Line (Copyright)</label>
            <input type="text" formControlName="copyright" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="© 2025 Artist Name">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">UPC / EAN Code</label>
            <input type="text" formControlName="upcCode" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none font-mono">
          </div>
          <div class="flex items-center gap-3 pt-2">
            <input type="checkbox" id="parental" formControlName="parentalAdvisory" class="h-4 w-4 rounded border-slate-800 bg-slate-950 text-teal-600 focus:ring-teal-600 focus:ring-offset-slate-950">
            <label for="parental" class="text-sm text-slate-300 select-none cursor-pointer">Explicit Content (Parental Advisory)</label>
          </div>
        </div>
      </div>
       @if (saveMessage()) {
        <div class="rounded border px-3 py-2 text-xs mt-4"
          [class.border-teal-500/40]="saveStatus() === 'ok'"
          [class.text-teal-300]="saveStatus() === 'ok'"
          [class.border-rose-500/40]="saveStatus() === 'error'"
          [class.text-rose-300]="saveStatus() === 'error'"
          [class.border-slate-700]="saveStatus() === 'saving'"
          [class.text-slate-300]="saveStatus() === 'saving'">
          {{ saveMessage() }}
        </div>
      }
      <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty || saveStatus() === 'saving'" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          @if (saveStatus() === 'saving') { Saving... } @else { Save Metadata }
        </button>
      </div>
    </form>
  `
})
export class AlbumMetadataComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private connectionService = inject(DeviceConnectionService);
  private fb: FormBuilder = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  saveStatus = signal<'idle' | 'saving' | 'ok' | 'error'>('idle');
  saveMessage = signal('');

  /** Bumped after every successful upload to force <img> cache-bust. */
  coverArtBust = signal(0);
  coverArtPreview = computed(() => {
    // DEVICE IS SOURCE OF TRUTH when connected + verified — survives browser
    // refresh and keeps the portal visually in sync with what's actually on SD.
    if (this.connectionService.connectionStatus() === 'wifi' && this.coverArtOnDevice()) {
      // Touch the bust signal so Angular re-computes when it changes.
      const bust = this.coverArtBust();
      return this.connectionService.wifi.coverArtUrl('/art/cover.jpg') + '&b=' + bust;
    }
    const a = this.album();
    return a?.artworkUrl || '';
  });
  coverArtPushStatus = signal('');
  coverArtUploading = signal(false);
  coverArtProgress = signal(0);
  coverArtOnDevice = signal(false);     // verified via HEAD /art/cover.jpg
  deviceArtist = signal('');            // what's actually on the device
  deviceAlbum  = signal('');
  metaDrift = computed(() => {
    const f = this.form.value;
    return (this.deviceArtist() && this.deviceArtist() !== (f.artistName || '').trim()) ||
           (this.deviceAlbum()  && this.deviceAlbum()  !== (f.title || '').trim());
  });

  form = this.fb.group({
    title: ['', Validators.required],
    artistName: ['', Validators.required],
    releaseType: ['album'],
    recordLabel: [''],
    genre: [''],
    releaseDate: [''],
    copyright: [''],
    upcCode: [''],
    parentalAdvisory: [false],
  });

  constructor() {
    // On wifi-connect, pull live state from the device so the portal never
    // silently diverges from what's actually on NVS / SD.
    effect(() => {
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.syncFromDevice();
      } else {
        this.coverArtOnDevice.set(false);
        this.deviceArtist.set('');
        this.deviceAlbum.set('');
      }
    });

    effect(() => {
      const a = this.album();
      if (a) {
        this.form.patchValue({
          title: a.title,
          artistName: a.artistName || '',
          recordLabel: a.recordLabel || '',
          genre: a.genre || '',
          releaseDate: a.releaseDate || '',
          copyright: a.copyright || '',
          upcCode: a.upcCode || '',
          parentalAdvisory: a.parentalAdvisory || false,
          releaseType: (a as any).releaseType || 'album'
        });
      }
    });
  }

  /** Pull live artist/album + cover-existence from the device.
   *  When cover art exists, also extract dominant colors and push
   *  them as the playback LED theme so lights always match the album. */
  private async syncFromDevice() {
    const [meta, coverOk] = await Promise.all([
      this.connectionService.wifi.pullMetadata(),
      this.connectionService.wifi.verifyCoverArt(),
    ]);
    if (meta.ok) {
      this.deviceArtist.set(meta.artist);
      this.deviceAlbum.set(meta.album);
    }
    this.coverArtOnDevice.set(coverOk);

    // Auto-extract LED colors from existing cover art on device
    if (coverOk) {
      try {
        const coverUrl = this.connectionService.wifi.coverArtUrl('/art/cover.jpg');
        const dataUrl = await this.fetchImageAsDataUrl(coverUrl);
        const [primary, secondary] = await this.extractDominantColors(dataUrl);
        await this.connectionService.wifi.pushTheme({
          led: {
            playback: { color: primary, pattern: 'vu_classic' },
          },
        } as any, undefined, secondary);
        console.log(`[SYNC→LED] Auto-pushed album colors from device cover: ${primary} / ${secondary}`);
      } catch (e) {
        console.warn('[SYNC→LED] Could not extract colors from device cover', e);
      }
    }
  }

  /** Fetch an image URL and return it as a data URL for canvas processing. */
  private fetchImageAsDataUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject('no canvas ctx'); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /** Overwrite the local form with whatever the device says. */
  pullFromDevice() {
    const a = this.album();
    if (!a) return;
    const artist = this.deviceArtist();
    const album  = this.deviceAlbum();
    if (!artist && !album) return;
    this.form.patchValue({
      artistName: artist || this.form.value.artistName,
      title:      album  || this.form.value.title,
    });
    this.form.markAsDirty();
  }

  async save() {
    const a = this.album();
    if (!a || !this.form.valid) return;

    this.saveStatus.set('saving');
    this.saveMessage.set('Saving metadata...');

    // Save locally
    this.dataService.updateAlbumMetadata(a.albumId, this.form.value);

    // Push artist + album to device if connected (sets SSID + NVS)
    if (this.connectionService.connectionStatus() === 'wifi') {
      const artist = (this.form.value.artistName || '').toString().trim();
      const title  = (this.form.value.title || '').toString().trim();
      const albumMetaPayload = {
        genre: (this.form.value.genre || '').toString().trim(),
        recordLabel: (this.form.value.recordLabel || '').toString().trim(),
        copyright: (this.form.value.copyright || '').toString().trim(),
        releaseDate: (this.form.value.releaseDate || '').toString().trim(),
        upcCode: (this.form.value.upcCode || '').toString().trim(),
        parentalAdvisory: !!this.form.value.parentalAdvisory,
      };
      const result = await this.connectionService.wifi.pushMetadata(artist, title);
      if (result.ok) {
        const albumMetaOk = await this.connectionService.wifi.pushAlbumMeta(albumMetaPayload);
        this.saveStatus.set(albumMetaOk ? 'ok' : 'error');
        this.saveMessage.set(
          albumMetaOk
            ? '✓ Metadata saved + pushed to device.'
            : 'Metadata saved locally and SSID updated, but extended album metadata did not reach the device.'
        );
        // Read back so the "device says" state matches what we just wrote
        await this.syncFromDevice();
      } else {
        // Device push failed — surface the REAL reason so user knows what to fix
        this.saveStatus.set('error');
        const reasonMsg: Record<string, string> = {
          timeout:  'Device did not respond in 8s. Check Wi-Fi to the DPA and retry.',
          network:  'Could not reach 192.168.4.1. Re-join the DPA Wi-Fi network.',
          http:     'Device returned an HTTP error. Try Force Rebuild.',
          firmware: 'Device received the request but rejected it. Firmware may need an update.',
          empty:    'Artist and album title are both empty — nothing to push.',
        };
        const tail = result.reason ? ` — ${reasonMsg[result.reason]}` : '';
        this.saveMessage.set(`Metadata saved locally. Device push failed${tail}`);
      }
    } else {
      this.saveStatus.set('ok');
      this.saveMessage.set('Metadata saved locally. Connect to device to push SSID update.');
    }

    this.form.markAsPristine();
  }

  onCoverArtSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const a = this.album();
    if (!a) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const fullDataUrl = reader.result as string;
      // Downscale to a 512px JPEG thumbnail before persisting to localStorage.
      // The full-res file still gets uploaded to the device below; only the
      // thumb lives in the browser so we never trip the 5MB quota.
      const thumb = await this.downscaleImage(fullDataUrl, 512, 0.82).catch(() => fullDataUrl);
      this.dataService.updateAlbumArtwork(a.albumId, thumb);

      // Mark form dirty so the Save Metadata button lights up
      this.form.markAsDirty();
      this.form.updateValueAndValidity();

      if (this.connectionService.connectionStatus() === 'wifi') {
        this.coverArtUploading.set(true);
        this.coverArtProgress.set(0);
        this.coverArtPushStatus.set('');
        // Downscale to 1024×1024 JPEG @ 0.85 (~200KB) before shipping to the
        // device. The ESP32-S3 Zero's AsyncWebServer stalls on multi-megabyte
        // static files over softAP WiFi, and 1024px is already 2x the hero
        // cover's visible size. The full-res original stays in the form for
        // distribution/export later.
        const deviceJpegDataUrl = await this.downscaleImage(fullDataUrl, 1024, 0.85).catch(() => fullDataUrl);
        const deviceFile = this.dataUrlToFile(deviceJpegDataUrl, 'cover.jpg');
        const ok = await this.connectionService.wifi.uploadFileToPath(
          deviceFile, '/art/cover.jpg',
          (pct) => this.coverArtProgress.set(pct)
        );
        this.coverArtUploading.set(false);
        this.coverArtProgress.set(ok ? 100 : 0);
        // Verify it actually landed on the SD card before claiming success
        let verified = false;
        if (ok) {
          // Small delay — firmware finishes SD write after HTTP 200
          await new Promise(r => setTimeout(r, 400));
          verified = await this.connectionService.wifi.verifyCoverArt();
          this.coverArtOnDevice.set(verified);
          if (verified) this.coverArtBust.set(Date.now());
        }
        // After verified cover upload, extract dominant colors from the art
        // and push them to the device as the playback LED theme so lights match the album.
        if (verified) {
          try {
            const [primary, secondary] = await this.extractDominantColors(fullDataUrl);
            await this.connectionService.wifi.pushTheme({
              led: {
                playback: { color: primary, pattern: 'vu_classic' },
              },
            } as any, undefined, secondary);
            console.log(`[COVER→LED] Pushed album colors: ${primary} / ${secondary}`);
          } catch (e) {
            console.warn('[COVER→LED] Color extraction failed, using defaults', e);
          }
        }
        this.coverArtPushStatus.set(
          verified ? '✓ Cover art + LED theme pushed to device'
          : ok     ? '⚠ Upload reported OK but file not found on SD. Retry.'
                   : '✗ Device upload failed — retry or check Wi-Fi.'
        );
        // Keep the bar + status visible for 6s so the user can actually see it finish
        setTimeout(() => {
          this.coverArtPushStatus.set('');
          this.coverArtProgress.set(0);
        }, 6000);
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  /** Convert a data URL (image/jpeg) to a File object for XHR upload. */
  private dataUrlToFile(dataUrl: string, filename: string): File {
    const [meta, b64] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  /**
   * Extract the two most dominant vibrant colors from a cover art image.
   * Uses canvas pixel sampling — picks the most saturated/bright colors,
   * clusters them, and returns [primary, secondary] as hex strings.
   * These drive the LED playback theme so the device lights match the album.
   */
  private extractDominantColors(dataUrl: string): Promise<[string, string]> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 64; // downsample for speed
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(['#0088ff', '#ff6600']); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Collect vibrant pixels (saturation > 30%, brightness > 20%)
        const buckets: { r: number; g: number; b: number; count: number }[] = [];
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const bright = max / 255;
          if (sat < 0.25 || bright < 0.15) continue;

          // Quantize to 4-bit buckets for clustering
          const qr = (r >> 4) << 4, qg = (g >> 4) << 4, qb = (b >> 4) << 4;
          let found = false;
          for (const bk of buckets) {
            if (Math.abs(bk.r - qr) < 32 && Math.abs(bk.g - qg) < 32 && Math.abs(bk.b - qb) < 32) {
              bk.r = (bk.r * bk.count + r) / (bk.count + 1);
              bk.g = (bk.g * bk.count + g) / (bk.count + 1);
              bk.b = (bk.b * bk.count + b) / (bk.count + 1);
              bk.count++;
              found = true;
              break;
            }
          }
          if (!found) buckets.push({ r, g, b, count: 1 });
        }

        // Sort by count (most frequent first), pick top 2 that differ enough
        buckets.sort((a, b) => b.count - a.count);
        const toHex = (c: { r: number; g: number; b: number }) =>
          '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

        const primary = buckets[0] || { r: 0, g: 136, b: 255 };
        let secondary = buckets[1] || primary;
        // Ensure secondary is visually distinct from primary
        for (let j = 1; j < buckets.length; j++) {
          const dr = Math.abs(buckets[j].r - primary.r);
          const dg = Math.abs(buckets[j].g - primary.g);
          const db = Math.abs(buckets[j].b - primary.b);
          if (dr + dg + db > 100) { secondary = buckets[j]; break; }
        }
        resolve([toHex(primary), toHex(secondary)]);
      };
      img.onerror = () => resolve(['#0088ff', '#ff6600']);
      img.src = dataUrl;
    });
  }

  /** Downscale a data URL to `maxEdge`px longest side as JPEG. */
  private downscaleImage(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('no canvas ctx');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  removeCoverArt() {
    const a = this.album();
    if (!a) return;
    this.dataService.updateAlbumArtwork(a.albumId, '');
  }
}

// #############################################################################
// ## BOOKLET COMPONENT
// #############################################################################

@Component({
  selector: 'app-album-booklet',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
   <form [formGroup]="form" (ngSubmit)="save()" class="pb-20">
      <div class="space-y-8">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Digital Booklet Configuration</h2>
            <p class="text-xs text-slate-500 mt-1">Configure the rich media experience available in the Fan Portal.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <!-- Left Column: Editors -->
          <div class="space-y-8">
            <div class="space-y-6">
              <div>
                <label class="block text-xs text-slate-400 mb-1">Liner Notes / Shoutouts (For Booklet)</label>
                <textarea formControlName="description" rows="4" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none resize-none"></textarea>
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">Full Lyrics (For Lyrics Tab)</label>
                <textarea formControlName="lyrics" rows="6" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 font-mono focus:border-teal-500 outline-none" placeholder="Markdown supported..."></textarea>
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">Album Credits (For Booklet)</label>
                <textarea formControlName="bookletCredits" rows="4" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none font-mono placeholder:text-slate-600" placeholder="Produced by... Mixed by..."></textarea>
              </div>
            </div>

            <!-- Gallery Images -->
            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <label class="block text-xs text-slate-400">Image Gallery (First image is booklet cover)</label>
                <button type="button" (click)="galleryInput.click()" class="text-xs text-teal-400 hover:text-teal-300">+ Upload Image</button>
                <input #galleryInput type="file" (change)="onGalleryFileSelected($event)" class="hidden" accept="image/*">
              </div>
              <div class="flex gap-4 overflow-x-auto pb-2 min-h-[100px] border border-dashed border-slate-800 rounded-lg p-4 bg-slate-900/30 items-center">
                @for (img of bookletGallery.controls; track $index) {
                  <div class="relative group flex-shrink-0">
                    <img [src]="img.value" class="h-20 w-32 object-cover rounded border border-slate-700">
                    <button type="button" (click)="removeGalleryImage($index)" class="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                  </div>
                } @empty {
                  <div class="w-full text-center text-xs text-slate-500">No images uploaded. Add BTS photos for the booklet.</div>
                }
              </div>
            </div>

            <!-- Videos -->
            <div class="space-y-3" formArrayName="bookletVideos">
              <div class="flex justify-between items-center">
                <label class="block text-xs text-slate-400">Attached Videos (For Videos Tab)</label>
                <button type="button" (click)="addVideo()" class="text-xs text-teal-400 hover:text-teal-300">+ Add Video URL</button>
              </div>
              <div class="space-y-3">
                @for (video of bookletVideos.controls; track $index) {
                  <div [formGroupName]="$index" class="flex gap-3 items-center bg-slate-900/50 p-3 rounded border border-slate-800">
                      <div class="flex-1 space-y-2">
                        <input type="text" formControlName="title" placeholder="Video Title" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
                        <input type="text" formControlName="url" placeholder="Video URL (mp4 or embed)" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-400 font-mono">
                      </div>
                      <button type="button" (click)="removeVideo($index)" class="text-rose-500 hover:text-rose-300 p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                  </div>
                } @empty {
                  <div class="text-xs text-slate-500 italic p-2">No videos linked.</div>
                }
              </div>
            </div>
          </div>

          <!-- Right Column: Live Mockup -->
          <div class="relative flex justify-center lg:block">
            <div class="sticky top-24">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest">Device Preview</h3>
                <span class="text-[10px] px-2 py-1 bg-teal-500/10 text-teal-400 rounded border border-teal-500/20 animate-pulse">Live Sync Active</span>
              </div>
              <div class="w-[320px] h-[640px] bg-slate-950 rounded-[3rem] border-8 border-slate-800 shadow-2xl relative overflow-hidden ring-1 ring-white/10 mx-auto">
                <div class="absolute inset-0 bg-black text-white flex flex-col overflow-hidden">
                  <div class="h-8 bg-black/80 flex items-center justify-between px-6 text-[10px] text-slate-400 font-medium shrink-0 z-20">
                    <span>9:41</span>
                    <div class="flex gap-1"><span class="w-3 h-3 bg-white/20 rounded-full"></span><span class="w-3 h-3 bg-white/20 rounded-full"></span></div>
                  </div>
                  <div class="flex-1 overflow-y-auto relative no-scrollbar bg-slate-900">
                    <div class="relative h-64 shrink-0">
                      <img [src]="previewCover()" class="w-full h-full object-cover">
                      <div class="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent"></div>
                      <div class="absolute bottom-0 left-0 right-0 p-6">
                        <h2 class="text-2xl font-bold leading-tight text-white mb-1">{{ album()?.title || 'Album Title' }}</h2>
                        <p class="text-sm text-slate-300">{{ album()?.artistName || 'Artist Name' }}</p>
                      </div>
                    </div>
                    <div class="p-6 pt-0 space-y-6 min-h-[300px]">
                      @if (previewTab() === 'booklet') {
                        <div class="animate-fade-in-up">
                          <div class="relative h-[400px]">
                            @switch (bookletPage()) {
                              @case(0) {
                                <div class="animate-fade-in-up">
                                  <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Album Cover</h3>
                                  <img [src]="previewCover()" class="w-full aspect-square object-cover rounded-lg bg-slate-800 shadow-lg">
                                </div>
                              }
                              @case(1) {
                                <div class="animate-fade-in-up">
                                  <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Tracklist</h3>
                                  <div class="space-y-3">
                                    @for (track of album()?.tracks; track track.id) {
                                      <div class="flex items-baseline gap-3 text-sm">
                                        <span class="text-slate-500 font-mono text-xs">{{ track.trackIndex + 1 }}.</span>
                                        <span class="text-slate-200 flex-1">{{ track.title }}</span>
                                      </div>
                                    } @empty {
                                      <div class="text-slate-500 text-xs italic">No tracks added.</div>
                                    }
                                  </div>
                                </div>
                              }
                              @case(2) {
                                <div class="animate-fade-in-up">
                                  <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Credits</h3>
                                  <div class="text-xs text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">{{ form.value.bookletCredits || 'Add credits to see them here...' }}</div>
                                </div>
                              }
                              @case(3) {
                                <div class="animate-fade-in-up">
                                  <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Liner Notes</h3>
                                  <p class="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{{ form.value.description || 'Add liner notes or a synopsis to see it here...' }}</p>
                                </div>
                              }
                            }
                             <div class="absolute bottom-0 left-0 right-0 flex justify-between items-center bg-slate-900 pt-4">
                               <button (click)="prevBookletPage()" class="px-3 py-1 rounded bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">‹ Prev</button>
                               <span class="text-xs font-mono text-slate-500">Page {{ bookletPage() + 1 }} / {{ totalBookletPages }}</span>
                               <button (click)="nextBookletPage()" class="px-3 py-1 rounded bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Next ›</button>
                             </div>
                          </div>
                        </div>
                      }
                      @if (previewTab() === 'lyrics') {
                        <div class="animate-fade-in-up"><h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Lyrics & Notes</h3><div class="prose prose-invert prose-sm"><p class="text-sm text-slate-300 font-serif leading-relaxed whitespace-pre-wrap">{{ form.value.lyrics || 'Lyrics will appear here...' }}</p></div></div>
                      }
                      @if (previewTab() === 'videos') {
                        <div class="animate-fade-in-up">
                          <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Attached Videos</h3>
                          <div class="space-y-4">
                            @for (video of bookletVideos.controls; track $index) {
                              <div class="flex items-center gap-4 bg-slate-800/50 p-2 rounded-lg border border-white/5 cursor-pointer hover:bg-slate-700/50 transition-colors">
                                <div class="relative w-24 h-16 shrink-0">
                                   <img [src]="video.value.poster" class="w-full h-full object-cover rounded">
                                   <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
                                      <div class="h-6 w-6 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                         <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white ml-px" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
                                      </div>
                                   </div>
                                </div>
                                <div class="flex-1">
                                  <div class="text-sm font-bold text-white leading-tight">{{ video.value.title }}</div>
                                </div>
                              </div>
                            } @empty {
                              <div class="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-700 rounded">
                                No videos added.
                              </div>
                            }
                          </div>
                        </div>
                      }
                      @if (previewTab() === 'gallery') {
                        <div class="animate-fade-in-up grid grid-cols-2 gap-2">
                          @for (img of bookletGallery.controls; track $index) {
                            <img [src]="img.value" class="w-full aspect-square object-cover rounded bg-slate-800">
                          } @empty {
                            <div class="col-span-2 py-8 text-center text-xs text-slate-500 border border-dashed border-slate-700 rounded">No photos uploaded</div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                  <div class="h-16 bg-slate-900 border-t border-slate-800 shrink-0 grid grid-cols-4 items-center">
                    <button (click)="previewTab.set('booklet')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'booklet'" [class.bg-transparent]="previewTab() !== 'booklet'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'booklet'" [class.text-slate-500]="previewTab() !== 'booklet'">Booklet</span></button>
                    <button (click)="previewTab.set('lyrics')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'lyrics'" [class.bg-transparent]="previewTab() !== 'lyrics'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'lyrics'" [class.text-slate-500]="previewTab() !== 'lyrics'">Lyrics</span></button>
                    <button (click)="previewTab.set('gallery')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'gallery'" [class.bg-transparent]="previewTab() !== 'gallery'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'gallery'" [class.text-slate-500]="previewTab() !== 'gallery'">Gallery</span></button>
                    <button (click)="previewTab.set('videos')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'videos'" [class.bg-transparent]="previewTab() !== 'videos'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'videos'" [class.text-slate-500]="previewTab() !== 'videos'">Videos</span></button>
                  </div>
                  <div class="h-6 bg-slate-900 flex justify-center items-start"><div class="w-32 h-1 bg-white/20 rounded-full mt-2"></div></div>
                </div>
              </div>
              <p class="text-center text-xs text-slate-500 mt-4">Interactive Preview • Click tabs to navigate</p>
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          Save Booklet
        </button>
      </div>
    </form>
  `
})
export class AlbumBookletComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  form = this.fb.group({
    description: [''],
    lyrics: [''],
    bookletCredits: [''],
    bookletVideos: this.fb.array([] as any[]),
    bookletGallery: this.fb.array([] as any[])
  });

  formValues = toSignal(this.form.valueChanges);
  previewTab = signal<'booklet' | 'lyrics' | 'gallery' | 'videos'>('booklet');

  // Interactive Booklet State
  bookletPage = signal(0);
  readonly totalBookletPages = 4; // Cover, Tracks, Credits, Notes

  private connectionService = inject(DeviceConnectionService);

  previewCover = computed(() => {
    const a = this.album();
    if (a?.artworkUrl) return a.artworkUrl;
    if (this.connectionService.connectionStatus() === 'wifi') {
      const deviceUrl = this.connectionService.wifi.coverArtUrl('/art/cover.jpg');
      if (deviceUrl) return deviceUrl;
    }
    const vals = this.formValues();
    const gallery = vals?.bookletGallery as string[] | undefined;
    if (gallery && gallery.length > 0) return gallery[0];
    return '';
  });

  get bookletVideos() { return this.form.get('bookletVideos') as FormArray; }
  get bookletGallery() { return this.form.get('bookletGallery') as FormArray; }

  constructor() {
    effect(() => {
      const a = this.album();
      if (a) {
        this.bookletVideos.clear();
        this.bookletGallery.clear();
        a.booklet?.videos?.forEach(v => this.bookletVideos.push(this.fb.group({ id: [v.id], title: [v.title], url: [v.url], poster: [v.poster] })));
        a.booklet?.gallery?.forEach(img => this.bookletGallery.push(this.fb.control(img)));

        this.form.patchValue({
          description: a.description || '',
          lyrics: a.lyrics || '',
          bookletCredits: a.booklet?.credits || ''
        });
      }
    });
  }

  nextBookletPage() {
    this.bookletPage.update(p => (p + 1) % this.totalBookletPages);
  }
  prevBookletPage() {
    this.bookletPage.update(p => (p - 1 + this.totalBookletPages) % this.totalBookletPages);
  }

  addVideo() { this.bookletVideos.push(this.fb.group({ id: [Math.random().toString(36).substr(2, 9)], title: ['New Video'], url: [''], poster: ['https://picsum.photos/seed/' + Math.random() + '/800/450'] })); }
  removeVideo(index: number) { this.bookletVideos.removeAt(index); }

  onGalleryFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => this.bookletGallery.push(this.fb.control(e.target?.result as string));
      reader.readAsDataURL(input.files[0]);
    }
  }
  removeGalleryImage(index: number) { this.bookletGallery.removeAt(index); }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const val = this.form.value;
      const videos: BookletVideo[] = (val.bookletVideos as any[]).map(v => ({ id: v.id, title: v.title, url: v.url, poster: v.poster || 'https://picsum.photos/seed/poster/800/450' }));
      const gallery: string[] = (val.bookletGallery as string[]);
      const metadata = {
        description: val.description,
        lyrics: val.lyrics,
        booklet: { credits: val.bookletCredits, gallery: gallery, videos: videos }
      };
      this.dataService.updateAlbumMetadata(a.albumId, metadata);
      const finish = (message: string) => {
        alert(message);
        this.form.markAsPristine();
      };
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.connectionService.wifi.pushBookletData({
          description: val.description || '',
          lyrics: val.lyrics || '',
          booklet: { credits: val.bookletCredits || '', gallery, videos }
        }).then((ok) => {
          finish(ok ? 'Booklet saved locally and pushed to device.' : 'Booklet saved locally, but device booklet sync failed.');
        }).catch(() => {
          finish('Booklet saved locally, but device booklet sync failed.');
        });
        return;
      }
      finish('Booklet saved locally.');
    }
  }
}

// #############################################################################
// ## PRICING COMPONENT
// #############################################################################

@Component({
  selector: 'app-album-pricing',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, PercentPipe, DecimalPipe],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="pb-20">
       <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold text-slate-50 uppercase tracking-tight">Pricing Strategy & Unit Economics</h2>
          <p class="text-sm text-slate-400 mt-1">Configure your retail model, analyze margins, and schedule manufacturing.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div (click)="selectTier('entry')" class="relative cursor-pointer rounded-xl border p-6 transition-all hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'entry'" [class.border-slate-800]="selectedTier() !== 'entry'" [class.bg-slate-800]="selectedTier() === 'entry'" [class.border-slate-600]="selectedTier() === 'entry'" [class.ring-1]="selectedTier() === 'entry'" [class.ring-slate-500]="selectedTier() === 'entry'"><div class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['entry'].label }}</div><div class="text-2xl font-bold text-slate-100">{{ TIER_CONFIG['entry'].min | currency }} - {{ TIER_CONFIG['entry'].max | currency }}</div><p class="text-xs text-slate-500 mt-2">{{ TIER_CONFIG['entry'].desc }}</p></div>
          <div (click)="selectTier('premium')" class="relative cursor-pointer rounded-xl border p-6 transition-all transform hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'premium'" [class.border-slate-800]="selectedTier() !== 'premium'" [class.bg-teal-900/10]="selectedTier() === 'premium'" [class.border-teal-500]="selectedTier() === 'premium'" [class.shadow-lg]="selectedTier() === 'premium'" [class.shadow-teal-900/20]="selectedTier() === 'premium'"><div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-[10px] font-bold uppercase px-3 py-1 rounded-full shadow-md">Recommended</div><div class="text-xs font-bold text-teal-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['premium'].label }}</div><div class="text-2xl font-bold text-white">{{ TIER_CONFIG['premium'].min | currency }} - {{ TIER_CONFIG['premium'].max | currency }}</div><p class="text-xs text-slate-400 mt-2">{{ TIER_CONFIG['premium'].desc }}</p></div>
          <div (click)="selectTier('collector')" class="relative cursor-pointer rounded-xl border p-6 transition-all hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'collector'" [class.border-slate-800]="selectedTier() !== 'collector'" [class.bg-indigo-900/10]="selectedTier() === 'collector'" [class.border-indigo-500]="selectedTier() === 'collector'" [class.ring-1]="selectedTier() === 'collector'" [class.ring-indigo-500]="selectedTier() === 'collector'"><div class="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['collector'].label }}</div><div class="text-2xl font-bold text-slate-100">{{ TIER_CONFIG['collector'].min | currency }} - {{ TIER_CONFIG['collector'].max | currency }}</div><p class="text-xs text-slate-500 mt-2">{{ TIER_CONFIG['collector'].desc }}</p></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 bg-slate-900/30 rounded-2xl border border-slate-800 p-8">
          <div class="space-y-10">
            <div>
              <div class="flex justify-between items-end mb-4">
                <div><label class="block text-sm font-semibold text-slate-200">Retail Price Strategy</label><p class="text-[10px] text-slate-500 mt-0.5">Drag to see how price impacts your earnings.</p></div>
                <div class="text-right"><div class="text-xs text-slate-400 mb-1">Your Take / Unit</div><div class="text-xl font-bold" [class.text-teal-400]="artistProfitPerUnit() > 0" [class.text-rose-500]="artistProfitPerUnit() <= 0">{{ artistProfitPerUnit() | currency }}</div></div>
              </div>
              <div class="flex items-center gap-4 mb-3"><div class="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 flex justify-between items-center"><span class="text-xs text-slate-500 uppercase font-bold tracking-wider">Retail Price (Fan Cost)</span><div class="flex items-center gap-1"><span class="text-slate-500 text-sm">$</span><input type="number" [value]="retailPriceVal()" (input)="updatePriceFromInput($event)" (keydown)="preventArrowKeyInput($event)" [min]="priceSliderMin" [max]="priceSliderMax" class="bg-transparent text-white font-bold w-16 text-right outline-none text-lg"></div></div></div>
              <div class="relative w-full pt-8">
                <div class="absolute top-0 h-6 px-2 flex items-center justify-center bg-teal-500 text-white text-xs font-bold rounded-full shadow-lg pointer-events-none" [style.left.%]="priceSliderPositionPercent()" style="transform: translateX(-50%); z-index: 10;">{{ retailPriceVal() | currency:'USD':'symbol':'1.0-0' }}</div>
                <input type="range" formControlName="retailPrice" [min]="priceSliderMin" [max]="priceSliderMax" step="1" class="w-full accent-teal-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer">
              </div>
              <div class="flex justify-between text-[10px] text-slate-500 mt-2 font-mono"><span>{{ TIER_CONFIG['entry'].min | currency }}</span><span>{{ TIER_CONFIG['collector'].max | currency }}</span></div>
            </div>
            <div>
              <div class="flex justify-between items-center mb-4"><label class="text-sm font-semibold text-slate-200">Production Volume</label><div class="text-sm font-mono text-teal-400">{{ productionVolume() | number }} units</div></div>
              <input type="range" [value]="productionVolume()" (input)="updateVolume($event)" min="50" max="100000" step="50" class="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer">
              <div class="flex justify-between text-[10px] text-slate-500 mt-2"><span>50 (Micro Run)</span><span>100k (High Scale)</span></div>
              <p class="text-[10px] text-slate-500 mt-3 flex items-center gap-2"><span class="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold">ECONOMIES OF SCALE</span>Wholesale price improves with volume.</p>
            </div>
            <div class="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-900/20 to-slate-900 p-6 flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-white/5 pb-3">
                <div><h3 class="text-xs font-bold text-indigo-400 uppercase tracking-wider">Profit Projection</h3></div>
                <div class="text-right"><div class="text-xs text-slate-400">For</div><div class="text-base font-bold text-white">{{ productionVolume() | number }} Units</div></div>
              </div>
              
              <div class="space-y-3 py-2">
                <div class="flex justify-between items-center text-sm"><span class="text-slate-400">Projected Gross Revenue</span><span class="font-mono text-slate-200">{{ projectedGrossRevenue() | currency }}</span></div>
                <div class="flex justify-between items-center text-sm"><span class="text-slate-400">(-) Hardware Costs</span><span class="font-mono text-slate-400">-{{ totalManufacturingCost() | currency }}</span></div>
                <div class="flex justify-between items-center text-sm"><span class="text-slate-400">(-) Platform Fees (15%)</span><span class="font-mono text-slate-400">-{{ totalPlatformFees() | currency }}</span></div>
              </div>

              <div class="border-t border-white/5 pt-4">
                <div class="flex justify-between items-center">
                  <div class="text-sm font-bold text-white uppercase tracking-wider">Projected Net Profit</div>
                  <div class="text-3xl font-black" [class.text-emerald-400]="totalProjectedProfit() > 0" [class.text-rose-500]="totalProjectedProfit() <= 0">
                    {{ totalProjectedProfit() | currency }}
                  </div>
                </div>
              </div>

              <button type="button" (click)="checkout()" class="w-full rounded bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/40 hover:bg-indigo-500 transition-all flex items-center justify-center gap-2 mt-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                Schedule Production Run
              </button>
            </div>
          </div>
          <div class="bg-slate-950 rounded-xl border border-slate-800 p-6 flex flex-col h-full">
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6 border-b border-slate-800 pb-2">Unit Economics Breakdown</h3>
            <div class="flex-1 flex flex-col justify-center space-y-6">
              
              <!-- Retail Price Breakdown -->
              <div class="relative">
                <div class="flex justify-between text-sm mb-1">
                    <span class="font-bold text-white">Retail Price Breakdown</span>
                    <span class="font-bold text-white">{{ retailPriceVal() | currency }}</span>
                </div>
                @if(artistProfitPerUnit() >= 0) {
                    <div class="h-8 bg-slate-800 rounded-full overflow-hidden flex text-[10px] font-bold text-white items-center text-center shadow-inner">
                        <div class="h-full flex items-center justify-center bg-slate-600" [style.width.%]="wholesalePricePercent()" title="Hardware Wholesale Cost (Your Cost)">
                            <span class="mix-blend-luminosity">HW Cost</span>
                        </div>
                        <div class="h-full flex items-center justify-center bg-indigo-500" [style.width.%]="platformFeePercent()" title="DPAC Platform Fee (15% of Retail)">
                            <span class="mix-blend-luminosity">Platform</span>
                        </div>
                        <div class="h-full flex items-center justify-center bg-teal-500" [style.width.%]="artistProfitPercent()" title="Your Net Profit">
                            <span class="mix-blend-luminosity">Artist</span>
                        </div>
                    </div>
                } @else {
                    <div class="h-8 bg-rose-500/20 rounded-full flex items-center justify-center text-xs font-bold text-rose-400 tracking-wider">
                        PRICE BELOW COST BASIS
                    </div>
                }
                <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div class="text-slate-400">
                        <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-slate-600"></div>Your Cost</div>
                        <div class="font-mono text-slate-200">{{ wholesalePrice() | currency }}</div>
                    </div>
                    <div class="text-slate-400 text-center">
                        <div class="flex items-center justify-center gap-2"><div class="w-2 h-2 rounded-full bg-indigo-500"></div>Platform Fee</div>
                        <div class="font-mono text-slate-200">{{ platformFee() | currency }}</div>
                    </div>
                    <div class="text-slate-400 text-right">
                        <div class="flex items-center justify-end gap-2"><div class="w-2 h-2 rounded-full" [class.bg-teal-500]="artistProfitPerUnit() >= 0" [class.bg-rose-500]="artistProfitPerUnit() < 0"></div>Your Profit</div>
                        <div class="font-mono" [class.text-teal-400]="artistProfitPerUnit() >= 0" [class.text-rose-400]="artistProfitPerUnit() < 0">{{ artistProfitPerUnit() | currency }}</div>
                    </div>
                </div>
              </div>
              
              <div class="space-y-2 pt-4 border-t border-slate-800/50">
                <div class="flex items-center justify-between text-xs"><div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-slate-600"></div><span class="text-slate-400">Hardware Wholesale Cost</span></div><span class="text-slate-200 font-mono">{{ wholesalePrice() | currency }}</span></div>
                <div class="pl-4 text-[10px] text-slate-500 font-mono">
                  (= {{ manufacturingCost() | currency }} Mfg Cost + {{ dpacHardwareMargin() | currency }} DPAC Margin)
                </div>
              </div>
              @if (connectionService.isSimulationMode()) {
                <div class="mt-8 p-4 bg-slate-900 rounded-lg border border-amber-500/30">
                  <div class="flex items-center justify-between mb-3"><div class="text-[10px] font-bold text-amber-500 uppercase tracking-wider">DPAC™ Operator P&L</div><span class="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[8px] font-bold text-amber-500 uppercase">Simulator Only</span></div>
                  <div class="space-y-2 text-xs font-mono">
                      <div class="flex justify-between items-center"><span class="text-slate-400">Revenue (HW Sale)</span><span class="text-white">{{ wholesalePrice() | currency }}</span></div>
                      <div class="flex justify-between items-center"><span class="text-slate-400">(-) COGS (Mfg Cost)</span><span class="text-slate-400">- {{ manufacturingCost() | currency }}</span></div>
                      <div class="flex justify-between items-center border-t border-slate-700/50 pt-1"><span class="text-slate-400">= Hardware Margin</span><span class="text-emerald-400">{{ dpacHardwareMargin() | currency }}</span></div>
                      <div class="flex justify-between items-center mt-2"><span class="text-slate-400">(+) Revenue (Platform Fee)</span><span class="text-white">{{ platformFee() | currency }}</span></div>
                  </div>
                  <div class="border-t border-slate-700/50 pt-2 mt-2 space-y-2">
                      <div class="flex justify-between items-center font-bold">
                          <span class="text-xs uppercase text-slate-300">Total Profit / Unit</span>
                          <span class="text-base text-indigo-400 font-mono">{{ dpacTotalProfitPerUnit() | currency }}</span>
                      </div>
                      <div class="flex justify-between items-center font-bold">
                          <span class="text-xs uppercase text-slate-300">Total Projected Profit</span>
                          <span class="text-lg text-indigo-400 font-mono">{{ totalDpacProjectedProfit() | currency }}</span>
                      </div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
       <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          Save Pricing
        </button>
      </div>

      <!-- Checkout Modal -->
      @if (showCheckoutModal()) {
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-950 shadow-2xl animate-fade-in-up" style="animation-duration: 0.2s;">
            <div class="p-6 border-b border-slate-800"><h3 class="text-lg font-bold text-slate-100">Schedule Production Run</h3><p class="text-sm text-slate-400 mt-1">Pay the scheduling deposit to secure your manufacturing date.</p></div>
            <div class="p-6 space-y-6">
              
              <div class="rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3">
                <div class="flex justify-between text-sm"><span class="text-slate-400">Production Volume</span><span class="text-white font-semibold">{{ productionVolume() | number }} units</span></div>
                <div class="flex justify-between text-sm"><span class="text-slate-400">Total Manufacturing Cost</span><span class="text-white font-semibold">{{ totalManufacturingCost() | currency }}</span></div>
              </div>

              <div class="space-y-2">
                <label class="block text-xs text-slate-400">Payment Options</label>
                <div class="grid grid-cols-2 gap-2">
                    <label (click)="paymentOption.set('deposit')" class="cursor-pointer rounded-lg border p-3 text-center transition-colors" [class.border-indigo-500]="paymentOption() === 'deposit'" [class.bg-indigo-900/20]="paymentOption() === 'deposit'" [class.border-slate-700]="paymentOption() !== 'deposit'">
                        <div class="font-semibold text-sm text-slate-100">Pay Deposit Only</div>
                        <div class="text-xs text-slate-400">{{ SCHEDULING_DEPOSIT | currency }}</div>
                    </label>
                    <label (click)="paymentOption.set('full')" class="cursor-pointer rounded-lg border p-3 text-center transition-colors" [class.border-indigo-500]="paymentOption() === 'full'" [class.bg-indigo-900/20]="paymentOption() === 'full'" [class.border-slate-700]="paymentOption() !== 'full'">
                        <div class="font-semibold text-sm text-slate-100">Pay Full Amount</div>
                        <div class="text-xs text-slate-400">{{ totalManufacturingCost() | currency }}</div>
                    </label>
                </div>
              </div>

              <div class="rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3">
                @if (paymentOption() === 'deposit') {
                  <div class="flex justify-between text-sm"><span class="text-slate-400">Scheduling Deposit</span><span class="text-white font-semibold">{{ SCHEDULING_DEPOSIT | currency }}</span></div>
                  <div class="flex justify-between text-xs"><span class="text-slate-500">Remaining Balance (due before shipping)</span><span class="text-slate-500">{{ (totalManufacturingCost() - SCHEDULING_DEPOSIT) | currency }}</span></div>
                }
                <div class="border-t border-slate-700/50 pt-3 flex justify-between">
                  <span class="text-sm font-bold text-slate-300">Amount Due Today</span>
                  <span class="text-xl font-bold text-indigo-400">{{ amountDueToday() | currency }}</span>
                </div>
              </div>
              
              <div [formGroup]="checkoutForm" class="space-y-2">
                <label class="block text-xs text-slate-400">Payment Method</label>
                <div class="flex items-center gap-3">
                  <select formControlName="paymentMethodId" class="flex-1 w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 focus:border-indigo-500 outline-none">
                    @for (method of userService.paymentMethods(); track method.id) { <option [value]="method.id">{{ method.name }} (**** {{ method.last4 }})</option> } @empty { <option value="" disabled>No payment methods found</option> }
                  </select>
                  <button type="button" (click)="showAddMethodModal.set(true)" class="rounded bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 border border-slate-700">+ Add</button>
                </div>
              </div>
            </div>
            <div class="p-4 bg-slate-900/50 rounded-b-xl flex justify-end gap-3">
              <button (click)="showCheckoutModal.set(false)" class="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button (click)="confirmAndPay()" [disabled]="checkoutForm.invalid" class="rounded bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-lg shadow-indigo-900/20">
                Pay {{ amountDueToday() | currency }} & Schedule
              </button>
            </div>
          </div>
        </div>
      }
      <!-- Add Method Modal -->
      @if (showAddMethodModal()) {
        <div class="fixed inset-0 z-[101] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-fade-in" [formGroup]="addMethodForm">
            <div class="flex items-center justify-between mb-6"><h3 class="text-lg font-bold text-slate-100">Add Payout Method</h3><button (click)="showAddMethodModal.set(false)" class="text-slate-500 hover:text-white">✕</button></div>
            <div class="space-y-4">
              <div class="flex gap-4 mb-2">
                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" formControlName="type" value="bank" class="text-indigo-500 focus:ring-indigo-500 bg-slate-900 border-slate-700"><span class="text-sm text-slate-300">Bank Account</span></label>
                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" formControlName="type" value="card" class="text-indigo-500 focus:ring-indigo-500 bg-slate-900 border-slate-700"><span class="text-sm text-slate-300">Debit Card</span></label>
              </div>
              <div><label class="block text-xs text-slate-400 mb-1">{{ addMethodForm.value.type === 'bank' ? 'Bank Name' : 'Card Brand' }}</label><input type="text" formControlName="name" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 focus:border-indigo-500 outline-none"></div>
              <div><label class="block text-xs text-slate-400 mb-1">{{ addMethodForm.value.type === 'bank' ? 'Account Number' : 'Card Number' }}</label><input type="text" formControlName="number" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 font-mono focus:border-indigo-500 outline-none"></div>
              @if (addMethodForm.value.type === 'bank') { <div><label class="block text-xs text-slate-400 mb-1">Routing Number</label><input type="text" formControlName="routing" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 font-mono focus:border-indigo-500 outline-none"></div> }
            </div>
            <div class="mt-6 flex justify-end gap-3"><button (click)="showAddMethodModal.set(false)" class="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button><button (click)="submitAddMethod()" [disabled]="addMethodForm.invalid" class="rounded bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">Save Method</button></div>
          </div>
        </div>
      }
    </form>
  `
})
export class AlbumPricingComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);
  connectionService = inject(DeviceConnectionService);
  userService = inject(UserService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  showCheckoutModal = signal(false);
  showAddMethodModal = signal(false);
  readonly SCHEDULING_DEPOSIT = 500;
  paymentOption = signal<'deposit' | 'full'>('deposit');

  form = this.fb.group({
    retailPrice: [79, [Validators.required, Validators.min(39)]],
  });

  checkoutForm = this.fb.group({ paymentMethodId: ['', Validators.required] });
  addMethodForm = this.fb.group({ type: ['bank', Validators.required], name: ['', Validators.required], number: ['', [Validators.required, Validators.minLength(4)]], routing: [''] });

  readonly TIER_CONFIG = { entry: { min: 39, max: 49, label: 'Entry / EP', desc: 'Impulse-friendly / Fan onboarding' }, premium: { min: 59, max: 79, label: 'Album / Premium', desc: 'Best balance of artist profit & value' }, collector: { min: 99, max: 149, label: 'Collector / Limited', desc: 'High margin / limited volume' } };
  selectedTier = signal<PricingTier>('premium');
  
  productionVolume = signal<number>(50);
  
  wholesalePrice = computed(() => {
    const vol = this.productionVolume();
    if (vol > 50000) return 25.00;
    if (vol > 25000) return 26.00;
    if (vol > 10000) return 27.00;
    if (vol > 2500) return 28.00;
    return 29.00;
  });

  retailPriceVal = toSignal(this.form.get('retailPrice')!.valueChanges, { initialValue: 79 });
  readonly priceSliderMin = this.TIER_CONFIG['entry'].min;
  readonly priceSliderMax = this.TIER_CONFIG['collector'].max;

  priceSliderPositionPercent = computed(() => { const retailPrice = this.retailPriceVal() ?? this.priceSliderMin; const range = this.priceSliderMax - this.priceSliderMin; if (range === 0) return 0; const position = ((retailPrice - this.priceSliderMin) / range) * 100; return Math.max(0, Math.min(100, position)); });
  manufacturingCost = computed(() => { const vol = this.productionVolume(); if (vol >= 50000) return 14.00; if (vol >= 10000) return 18.00; return 22.00; });
  platformFee = computed(() => (this.retailPriceVal() || 0) * 0.15);
  artistCostsPerUnit = computed(() => this.wholesalePrice() + this.platformFee());
  artistProfitPerUnit = computed(() => (this.retailPriceVal() || 0) - this.artistCostsPerUnit());
  
  wholesalePricePercent = computed(() => {
    const retail = this.retailPriceVal() || 1;
    return Math.max(0, (this.wholesalePrice() / retail) * 100);
  });
  platformFeePercent = computed(() => {
    const retail = this.retailPriceVal() || 1;
    return Math.max(0, (this.platformFee() / retail) * 100);
  });
  artistProfitPercent = computed(() => {
    const retail = this.retailPriceVal() || 1;
    const profit = this.artistProfitPerUnit();
    return Math.max(0, (profit / retail) * 100);
  });

  dpacHardwareMargin = computed(() => this.wholesalePrice() - this.manufacturingCost());
  dpacTotalProfitPerUnit = computed(() => this.platformFee() + this.dpacHardwareMargin());
  totalManufacturingCost = computed(() => this.productionVolume() * this.wholesalePrice());
  totalProjectedProfit = computed(() => this.artistProfitPerUnit() * this.productionVolume());
  totalDpacProjectedProfit = computed(() => this.dpacTotalProfitPerUnit() * this.productionVolume());
  
  projectedGrossRevenue = computed(() => (this.retailPriceVal() || 0) * this.productionVolume());
  totalPlatformFees = computed(() => this.platformFee() * this.productionVolume());

  amountDueToday = computed(() => this.paymentOption() === 'deposit' ? this.SCHEDULING_DEPOSIT : this.totalManufacturingCost());

  constructor() {
    effect(() => { const a = this.album(); if (a) { this.form.patchValue({ retailPrice: a.pricing?.retailPrice || 79 }); } });
    this.form.get('retailPrice')?.valueChanges.subscribe(val => { if (val !== null && val !== undefined) { if (val <= 49) { this.selectedTier.set('entry'); } else if (val > 49 && val <= 79) { this.selectedTier.set('premium'); } else if (val > 79) { this.selectedTier.set('collector'); } } });
    effect(() => { const methods = this.userService.paymentMethods(); if (methods.length > 0) { const defaultMethod = methods.find(m => m.isDefault) || methods[0]; if (defaultMethod) { this.checkoutForm.patchValue({ paymentMethodId: defaultMethod.id }); } } });
  }

  preventArrowKeyInput(event: KeyboardEvent) { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault(); }
  updatePriceFromInput(event: Event) { const valueAsNumber = Number((event.target as HTMLInputElement).value); if (!isNaN(valueAsNumber)) this.form.get('retailPrice')?.setValue(valueAsNumber); }
  selectTier(tier: PricingTier) { this.selectedTier.set(tier); let optimalPrice = this.TIER_CONFIG[tier].max; if (tier === 'entry') optimalPrice = 49; if (tier === 'premium') optimalPrice = 79; if (tier === 'collector') optimalPrice = 129; this.form.get('retailPrice')?.setValue(optimalPrice); }
  updateVolume(event: Event) { const val = parseInt((event.target as HTMLInputElement).value, 10); if (!isNaN(val)) { this.productionVolume.set(val); } }
  
  checkout() {
    this.paymentOption.set('deposit');
    this.showCheckoutModal.set(true);
  }

  confirmAndPay() {
    if (this.checkoutForm.invalid) { alert('Please select a payment method.'); return; }
    const cost = this.amountDueToday();
    const selectedMethod = this.userService.paymentMethods().find(m => m.id === this.checkoutForm.value.paymentMethodId);
    const paymentType = this.paymentOption() === 'deposit' ? 'scheduling deposit' : 'full manufacturing cost';
    
    if (confirm(`Confirm payment of ${cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} (${paymentType}) to ${selectedMethod?.name} (**** ${selectedMethod?.last4}) for ${this.productionVolume()} units?`)) {
      this.save();
      alert('Payment successful! Production run scheduled.');
      this.showCheckoutModal.set(false);
    }
  }

  submitAddMethod() {
    if (this.addMethodForm.valid) {
      const val = this.addMethodForm.value;
      this.userService.addPaymentMethod({ type: val.type as 'bank' | 'card', name: val.name || 'Unknown', last4: val.number?.slice(-4) || '0000', isDefault: this.userService.paymentMethods().length === 0 });
      this.showAddMethodModal.set(false);
      this.addMethodForm.reset({ type: 'bank' });
      const paymentMethods = this.userService.paymentMethods();
      const newMethod = paymentMethods[paymentMethods.length - 1];
      if (newMethod) { this.checkoutForm.patchValue({ paymentMethodId: newMethod.id }); }
    }
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const newPricing = { 
        retailPrice: this.form.value.retailPrice || 0, 
        currency: 'USD'
      };

      const newEconomics: UnitEconomics = {
        ...(a.economics!),
        totalManufactured: this.productionVolume(),
        manufacturingCost: this.manufacturingCost(),
        wholesalePrice: this.wholesalePrice(),
      };

      this.dataService.updateAlbumMetadata(a.albumId, { 
        pricing: newPricing,
        economics: newEconomics
      });
      alert('Pricing saved!');
      this.form.markAsPristine();
    }
  }
}
