
import { Component, inject, computed } from '@angular/core';
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

  // Use backend-sourced capsule data
  allCapsules = this.dataService.getAllCapsules();
  latestCapsule = computed(() => this.allCapsules()?.[0]);

  // Use device-sourced library data
  library = computed(() => this.connectionService.deviceLibrary());

  logout() {
    this.router.navigate(['/login']);
  }
}
