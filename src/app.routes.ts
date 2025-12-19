
import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { CreateAlbumComponent } from './pages/create-album/create-album.component';
import { AlbumLayoutComponent } from './components/album-layout/album-layout.component';
import { AlbumOverviewComponent } from './pages/album-overview/album-overview.component';
import { TrackListComponent } from './pages/track-list/track-list.component';
import { ThemeEditorComponent } from './pages/theme-editor/theme-editor.component';
import { PerksConsoleComponent } from './pages/perks-console/perks-console.component';
import { DevicesDashboardComponent } from './pages/devices-dashboard/devices-dashboard.component';
import { UserAdminComponent } from './pages/user-admin/user-admin.component';
import { AlbumMetadataComponent, AlbumBookletComponent, AlbumPricingComponent } from './pages/album-metadata/album-metadata.component';
import { LoginComponent } from './pages/login/login.component';
import { FanLayoutComponent } from './pages/fan-portal/fan-layout.component';
import { FanHomeComponent } from './pages/fan-portal/fan-home.component';
import { FanAlbumDetailComponent } from './pages/fan-portal/fan-album-detail.component';
import { FanCapsulesComponent } from './pages/fan-portal/fan-capsules.component';
import { FanDeviceRegistrationComponent } from './pages/fan-portal/fan-device-registration.component';
import { FanMarketplaceComponent } from './pages/fan-portal/fan-marketplace.component';
import { FanCheckoutComponent } from './pages/fan-portal/fan-checkout.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  
  // Artist Portal
  { 
    path: 'artist',
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'albums/new', component: CreateAlbumComponent },
      { path: 'account', component: UserAdminComponent },
      {
        path: 'albums/:id',
        component: AlbumLayoutComponent,
        children: [
          { path: '', redirectTo: 'overview', pathMatch: 'full' },
          { path: 'overview', component: AlbumOverviewComponent },
          { path: 'metadata', component: AlbumMetadataComponent },
          { path: 'tracks', component: TrackListComponent },
          { path: 'booklet', component: AlbumBookletComponent },
          { path: 'theme', component: ThemeEditorComponent },
          { path: 'perks', component: PerksConsoleComponent },
          { path: 'pricing', component: AlbumPricingComponent },
          { path: 'devices', component: DevicesDashboardComponent }
        ]
      }
    ]
  },

  // Fan Portal
  {
    path: 'fan',
    component: FanLayoutComponent,
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'home', component: FanHomeComponent },
      { path: 'album/:id', component: FanAlbumDetailComponent },
      { path: 'capsules', component: FanCapsulesComponent },
      { path: 'marketplace', component: FanMarketplaceComponent },
      { path: 'devices', component: FanDeviceRegistrationComponent },
      { path: 'checkout', component: FanCheckoutComponent }
    ]
  }
];
