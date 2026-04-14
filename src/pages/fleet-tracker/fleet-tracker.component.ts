
import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { FleetService, FleetDevice, DeviceAnalytics } from '../../services/fleet.service';

@Component({
  selector: 'app-fleet-tracker',
  standalone: true,
  imports: [CommonModule, DecimalPipe, DatePipe],
  templateUrl: './fleet-tracker.component.html',
})
export class FleetTrackerComponent implements OnInit, OnDestroy {
  fleet = inject(FleetService);

  expandedDevice = signal<string | null>(null);
  deviceDetail = signal<DeviceAnalytics | null>(null);
  detailLoading = signal(false);

  ngOnInit() {
    void this.fleet.refreshAll();
    this.fleet.startActivityPolling();
  }

  ngOnDestroy() {
    this.fleet.stopActivityPolling();
  }

  refresh() {
    void this.fleet.refreshAll();
  }

  formatListenTime(ms: number): string {
    if (!ms) return '0m';
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  async toggleDevice(deviceId: string) {
    if (this.expandedDevice() === deviceId) {
      this.expandedDevice.set(null);
      this.deviceDetail.set(null);
      return;
    }
    this.expandedDevice.set(deviceId);
    this.detailLoading.set(true);
    const detail = await this.fleet.getDeviceAnalytics(deviceId);
    this.deviceDetail.set(detail);
    this.detailLoading.set(false);
  }

  getEventIcon(type: string): string {
    switch (type) {
      case 'play': return '▶';
      case 'skip': return '⏭';
      case 'heart': return '♥';
      case 'listen_ms': return '🎧';
      default: return '•';
    }
  }

  reachabilityClass(r: string): string {
    switch (r) {
      case 'online': return 'bg-emerald-500';
      case 'stale': return 'bg-amber-500';
      default: return 'bg-slate-600';
    }
  }
}
