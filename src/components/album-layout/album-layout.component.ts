import { Component, Input, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-album-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './album-layout.component.html'
})
export class AlbumLayoutComponent {
  private dataService = inject(DataService);

  @Input() id!: string; // From router param

  album = computed(() => this.dataService.getAlbum(this.id)());
}
