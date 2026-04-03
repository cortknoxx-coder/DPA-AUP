
import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerService } from '../../services/player.service';

@Component({
  selector: 'app-fan-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './fan-home.component.html'
})
export class FanHomeComponent {
  connectionService = inject(DeviceConnectionService);
  playerService = inject(PlayerService);
  private dataService = inject(DataService);
  private router = inject(Router);
  private wifi = this.connectionService.wifi;

  // Use backend-sourced capsule data
  allCapsules = this.dataService.getAllCapsules();

  // Use device-sourced library data
  library = computed(() => this.connectionService.deviceLibrary());
  liveCapsules = signal<any[]>([]);
  capsules = computed(() => this.liveCapsules().length > 0 ? this.liveCapsules() : this.allCapsules());
  latestCapsule = computed(() => this.capsules()?.[0]);

  constructor() {
    effect(() => {
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.refreshLiveCapsules();
      } else {
        this.liveCapsules.set([]);
      }
    }, { allowSignalWrites: true });
  }

  private async refreshLiveCapsules() {
    try {
      const raw = await this.wifi.getCapsules();
      const normalized = raw.map((c: any) => ({
        ...c,
        payload: {
          title: c.title ?? 'Untitled Capsule',
          description: c.desc ?? '',
        }
      }));
      this.liveCapsules.set(normalized);
    } catch {
      // keep DataService fallback
    }
  }

  logout() {
    this.router.navigate(['/login']);
  }

  openConnectionOptions() {
    this.router.navigate(['/fan/auth']);
  }
}
