
import { Component, inject, computed, signal } from '@angular/core';
import { RouterOutlet, RouterLink, Router, NavigationEnd } from '@angular/router';
import { DeviceConnectionService } from './services/device-connection.service';
import { UserService } from './services/user.service';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.component.html'
})
export class AppComponent {
  connectionService = inject(DeviceConnectionService);
  userService = inject(UserService);
  private router = inject(Router);

  showConnectionMenu = signal(false);

  // Check if current route is NOT Artist portal
  // We hide the global nav on Login and Fan Portal routes
  hideArtistNav = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map((e: any) => e.url.startsWith('/fan') || e.url.startsWith('/login') || e.url === '/')
    ),
    { initialValue: true } // Default to hidden (Login screen)
  );

  userInitials = computed(() => {
    const name = this.userService.userProfile().name;
    if (!name) return '';
    const parts = name.split(' ');
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  });

  toggleConnectionMenu() {
    this.showConnectionMenu.update(v => !v);
  }
}
