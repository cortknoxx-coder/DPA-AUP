
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { PlayerService } from '../../services/player.service';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';

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

  allCapsules = this.dataService.getAllCapsules();
  latestCapsule = computed(() => this.allCapsules()?.[0]);

  logout() {
    this.router.navigate(['/login']);
  }
}
