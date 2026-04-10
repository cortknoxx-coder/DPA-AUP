import { Component, Input, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { DataService } from '../../services/data.service';
import { DeviceRuntimeBannerComponent } from '../device-runtime-banner/device-runtime-banner.component';

@Component({
  selector: 'app-album-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, DeviceRuntimeBannerComponent],
  templateUrl: './album-layout.component.html'
})
export class AlbumLayoutComponent {
  private dataService = inject(DataService);
  private router = inject(Router);

  @Input() id!: string;

  album = computed(() => this.dataService.getAlbum(this.id)());

  constructor() {
    effect(() => {
      const a = this.album();
      if (!a && this.id) {
        const all = this.dataService.albums();
        if (all.length > 0) {
          this.router.navigate(['/artist/albums', all[0].albumId], { replaceUrl: true });
        } else {
          this.router.navigate(['/artist/dashboard'], { replaceUrl: true });
        }
      }
    });
  }
}
