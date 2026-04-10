import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { BrandMarkComponent } from '../../components/brand-mark/brand-mark.component';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, BrandMarkComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  private dataService = inject(DataService);
  albums = this.dataService.albums;
  defaultCover = DEFAULT_COVER_DATA_URL;
}
