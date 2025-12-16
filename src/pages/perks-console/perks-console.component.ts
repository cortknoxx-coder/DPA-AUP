import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-perks-console',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perks-console.component.html'
})
export class PerksConsoleComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Form State
  eventType = 'concert';
  title = '';
  details = '';

  create() {
    if (this.title) {
      const a = this.album();
      if (a) {
        this.dataService.createDcnpEvent(a.albumId, {
          eventType: this.eventType as any,
          payload: { kind: this.eventType, data: { title: this.title, details: this.details } }
        });
        this.title = '';
        this.details = '';
      }
    }
  }
}
