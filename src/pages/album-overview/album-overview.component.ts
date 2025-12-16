import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-album-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './album-overview.component.html'
})
export class AlbumOverviewComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);

  // Get parent's ID param since this is a child route
  private id = computed(() => this.route.parent?.snapshot.params['id']);
  
  album = computed(() => this.dataService.getAlbum(this.id())());

  rebuild() {
    const a = this.album();
    if (a) {
      this.dataService.triggerRebuild(a.albumId);
    }
  }
}
