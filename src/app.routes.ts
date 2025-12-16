import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { CreateAlbumComponent } from './pages/create-album/create-album.component';
import { AlbumLayoutComponent } from './components/album-layout/album-layout.component';
import { AlbumOverviewComponent } from './pages/album-overview/album-overview.component';
import { TrackListComponent } from './pages/track-list/track-list.component';
import { ThemeEditorComponent } from './pages/theme-editor/theme-editor.component';
import { PerksConsoleComponent } from './pages/perks-console/perks-console.component';
import { DevicesDashboardComponent } from './pages/devices-dashboard/devices-dashboard.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'albums/new', component: CreateAlbumComponent },
  {
    path: 'albums/:id',
    component: AlbumLayoutComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: AlbumOverviewComponent },
      { path: 'tracks', component: TrackListComponent },
      { path: 'theme', component: ThemeEditorComponent },
      { path: 'perks', component: PerksConsoleComponent },
      { path: 'devices', component: DevicesDashboardComponent }
    ]
  }
];
