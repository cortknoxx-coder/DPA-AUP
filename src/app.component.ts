
import { Component, DestroyRef, inject, computed, signal } from '@angular/core';
import { RouterOutlet, RouterLink, Router, NavigationEnd } from '@angular/router';
import { DeviceConnectionService } from './services/device-connection.service';
import { UserService } from './services/user.service';
import { ThemeModeService } from './services/theme-mode.service';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DeviceHudOverlayComponent } from './components/device-hud-overlay/device-hud-overlay.component';
import { DeviceNotificationCenterComponent } from './components/device-notification-center/device-notification-center.component';
import { ToastHostComponent } from './design/components/toast-host.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, DeviceHudOverlayComponent, DeviceNotificationCenterComponent, ToastHostComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  connectionService = inject(DeviceConnectionService);
  userService = inject(UserService);
  themeMode = inject(ThemeModeService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  showConnectionMenu = signal(false);
  connectionAction = signal<'detect' | 'wifi' | 'usb' | 'nfc' | null>(null);
  private mobileMediaQuery =
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)') : null;
  isSmallScreen = signal(this.mobileMediaQuery?.matches ?? false);

  // Check if current route is NOT Artist portal
  // We hide the global nav on Login and Fan Portal routes
  hideArtistNav = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map((e: any) => e.url.startsWith('/fan') || e.url.startsWith('/login') || e.url.startsWith('/internal') || e.url === '/')
    ),
    { initialValue: true } // Default to hidden (Login screen)
  );


  showGlobalDeviceUi = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map((e: any) => !(e.url.startsWith('/login') || e.url.startsWith('/internal') || e.url === '/'))
    ),
    { initialValue: false }
  );

  showFloatingHud = computed(() => this.showGlobalDeviceUi() && !this.isSmallScreen());

  userInitials = computed(() => {
    const name = this.userService.userProfile().name;
    if (!name) return '';
    const parts = name.split(' ');
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  });

  constructor() {
    if (this.mobileMediaQuery) {
      const handleChange = (event: MediaQueryListEvent) => this.isSmallScreen.set(event.matches);
      this.mobileMediaQuery.addEventListener('change', handleChange);
      this.destroyRef.onDestroy(() => this.mobileMediaQuery?.removeEventListener('change', handleChange));
    }
  }

  toggleConnectionMenu() {
    this.showConnectionMenu.update(v => !v);
  }

  private async runConnectionAction(
    action: 'detect' | 'wifi' | 'usb' | 'nfc',
    task: () => Promise<boolean | string | null | undefined>
  ) {
    if (this.connectionAction()) return;
    this.connectionAction.set(action);
    try {
      const result = await task();
      if (result) {
        this.showConnectionMenu.set(false);
      }
    } finally {
      this.connectionAction.set(null);
    }
  }

  detectConnectedDevice() {
    return this.runConnectionAction('detect', () => this.connectionService.detectConnectedDevice());
  }

  connectWifi() {
    return this.runConnectionAction('wifi', () => this.connectionService.connectViaWifi());
  }

  connectUsb() {
    return this.runConnectionAction('usb', () => this.connectionService.connectToBridge());
  }

  connectNfc() {
    return this.runConnectionAction('nfc', () => this.connectionService.connectViaNfc());
  }
}
