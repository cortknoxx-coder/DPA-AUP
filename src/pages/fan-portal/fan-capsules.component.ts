
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { UserService } from '../../services/user.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { CryptoService } from '../../services/crypto.service';
import { DcnpEvent, DcnpEventType } from '../../types';
import { mergeCapsuleFeeds } from '../../services/device-content.utils';

type FilterType = 'all' | DcnpEventType;

const EVENT_TYPE_COLORS: Record<DcnpEventType, string> = {
  concert: '#f43f5e',
  video: '#06b6d4',
  merch: '#f59e0b',
  signing: '#8b5cf6',
  remix: '#f97316',
  other: '#94a3b8',
};

@Component({
  selector: 'app-fan-capsules',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, CurrencyPipe],
  templateUrl: './fan-capsules.component.html',
})
export class FanCapsulesComponent {
  private dataService = inject(DataService);
  private userService = inject(UserService);
  private connectionService = inject(DeviceConnectionService);
  private cryptoService = inject(CryptoService);

  portalCapsules = this.dataService.getAllCapsules();
  allCapsules = computed(() =>
    mergeCapsuleFeeds(this.portalCapsules(), this.connectionService.deviceCapsules(), {
      albumId: this.connectionService.deviceLibrary()?.albums?.[0]?.id,
      albumTitle: this.connectionService.deviceLibrary()?.albums?.[0]?.title,
      artistName: this.dataService.albums()?.[0]?.artistName,
    })
  );

  // --- Filter state ---
  activeFilter = signal<FilterType>('all');
  filterTypes: FilterType[] = ['all', 'concert', 'video', 'merch', 'remix', 'other'];

  capsuleCountByType = computed(() => {
    const capsules = this.allCapsules();
    const counts: Record<string, number> = { all: capsules.length };
    for (const type of this.filterTypes) {
      if (type !== 'all') {
        counts[type] = capsules.filter(c => c.eventType === type).length;
      }
    }
    return counts;
  });

  filteredCapsules = computed(() => {
    const filter = this.activeFilter();
    const capsules = this.allCapsules();
    if (filter === 'all') return capsules;
    return capsules.filter(c => c.eventType === filter);
  });

  // --- Expand/collapse state ---
  expandedCapsules = signal<Set<string>>(new Set());

  // --- Reaction state ---
  reactions = signal<Record<string, string[]>>({});
  reactionEmojis = ['🔥', '❤️', '🤯'];

  // --- Download/transfer state ---
  downloadState = signal<Record<string, number | 'installed'>>({});

  // --- Methods ---

  setFilter(type: FilterType) {
    this.activeFilter.set(type);
  }

  toggleExpand(id: string) {
    this.expandedCapsules.update(set => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  isExpanded(id: string): boolean {
    return this.expandedCapsules().has(id);
  }

  addReaction(capsuleId: string, emoji: string) {
    this.reactions.update(curr => {
      const existing = curr[capsuleId] || [];
      // Toggle: remove if already reacted with this emoji, add otherwise
      const updated = existing.includes(emoji)
        ? existing.filter(e => e !== emoji)
        : [...existing, emoji];
      return { ...curr, [capsuleId]: updated };
    });
  }

  hasReaction(capsuleId: string, emoji: string): boolean {
    return (this.reactions()[capsuleId] || []).includes(emoji);
  }

  isNew(capsule: DcnpEvent): boolean {
    if (!capsule.deliveredAt) return false;
    const deliveredTime = new Date(capsule.deliveredAt).getTime();
    const now = Date.now();
    const fortyEightHours = 48 * 60 * 60 * 1000;
    return (now - deliveredTime) < fortyEightHours;
  }

  eventTypeColor(type: DcnpEventType): string {
    return EVENT_TYPE_COLORS[type] || '#94a3b8';
  }

  filterLabel(type: FilterType): string {
    if (type === 'all') return 'All';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  // --- Existing download/transfer logic (unchanged) ---

  onInteraction(capsule: DcnpEvent) {
    if (!capsule.payload.cta) return;

    if (capsule.payload.cta.action === 'link') {
      window.open(capsule.payload.cta.url, '_blank');
      return;
    }

    if (capsule.payload.cta.action === 'download') {
      this.handleDownload(capsule);
    }
  }

  handleDownload(capsule: DcnpEvent) {
    const currentState = this.downloadState()[capsule.id];
    if (currentState === 'installed') return;

    const conn = this.connectionService.connectionStatus();
    if (conn === 'disconnected') {
      alert('DPA Device Required: Please connect your device via USB-C, Bluetooth, or WiFi to transfer this content securely.');
      return;
    }

    if (capsule.payload.price && capsule.payload.price > 0) {
      const confirmMsg = `Confirm Purchase: $${capsule.payload.price}\n\nThis will be charged to your default payment method and funds will be transferred to ${capsule.payload.cta?.label.includes('Remix') ? 'the Artist' : 'the Artist'} immediately.`;

      if (!confirm(confirmMsg)) return;

      this.userService.recordTransaction(capsule.payload.price);
    }

    this.transferToDevice(capsule);
  }

  async transferToDevice(capsule: DcnpEvent) {
    const conn = this.connectionService.connectionStatus();
    const duid = this.connectionService.deviceInfo()?.serial;

    this.updateState(capsule.id, 0);

    if (conn === 'wifi') {
      try {
        this.updateState(capsule.id, 20);

        const pushed = await this.connectionService.wifi.pushCapsule(
          capsule.eventType,
          capsule.id,
          capsule.payload
        );

        this.updateState(capsule.id, 60);

        if (pushed) {
          console.log(`[Capsule] Pushed ${capsule.eventType} capsule "${capsule.id}" to device`);
        }

        if (capsule.payload.cta?.action === 'download' && duid) {
          this.updateState(capsule.id, 70);

          const encoder = new TextEncoder();
          const contentData = encoder.encode(JSON.stringify({
            capsuleId: capsule.id,
            eventType: capsule.eventType,
            payload: capsule.payload,
            downloadedAt: new Date().toISOString()
          }));

          const dpaData = await this.cryptoService.encryptForDevice(contentData.buffer as ArrayBuffer, duid, 'capsule');
          const dpaFilename = `capsule-${capsule.id}.dpa`;
          const dpaFile = new File([dpaData], dpaFilename, { type: 'application/octet-stream' });

          this.updateState(capsule.id, 85);

          await this.connectionService.wifi.uploadFileToPath(dpaFile, `/capsules/${dpaFilename}`, (percent) => {
            this.updateState(capsule.id, 85 + Math.round(percent * 0.15));
          });
        }

        this.updateState(capsule.id, 'installed');
      } catch (err) {
        console.error('[Capsule] Transfer failed:', err);
        this.simulateFallbackTransfer(capsule.id);
      }
    } else {
      if (conn === 'bluetooth') {
        try {
          await this.connectionService.ble.sendCommand(0x10);
        } catch {}
      }

      this.simulateFallbackTransfer(capsule.id);
    }
  }

  private simulateFallbackTransfer(id: string) {
    let progress = 0;
    this.updateState(id, 0);

    const interval = setInterval(() => {
      progress += 5;
      this.updateState(id, progress);

      if (progress >= 100) {
        clearInterval(interval);
        this.updateState(id, 'installed');
      }
    }, 100);
  }

  updateState(id: string, val: number | 'installed') {
    this.downloadState.update(curr => ({
      ...curr,
      [id]: val
    }));
  }
}
