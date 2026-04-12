import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { UserService } from '../services/user.service';
import { UserRole } from '../types';
import { InternalOperatorAuthService } from '../services/internal-operator-auth.service';
import { DeviceConnectionService } from '../services/device-connection.service';

type GuardedPortal = UserRole;

function checkPortalAccess(portal: GuardedPortal): true | UrlTree {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.canAccessPortal(portal)
    ? true
    : router.parseUrl(userService.deniedPortalRedirect(portal));
}

export const requireCreatorPortalGuard: CanActivateFn = () => checkPortalAccess('creator');
export const requireFanPortalGuard: CanActivateFn = () => checkPortalAccess('fan');
export const requireConnectedDeviceGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  if (route.data?.['skipDeviceGate'] === true) return true;

  const connection = inject(DeviceConnectionService);
  const router = inject(Router);
  if (connection.connectionStatus() !== 'disconnected') return true;

  const detected = await connection.detectConnectedDevice({ silent: true, preferCurrent: true });
  if (detected) return true;

  const redirectTo = typeof route.data?.['deviceGateRedirect'] === 'string'
    ? route.data['deviceGateRedirect']
    : '/fan/auth';
  return router.parseUrl(redirectTo);
};
export const requireOperatorPortalGuard: CanActivateFn = async () => {
  const auth = inject(InternalOperatorAuthService);
  const router = inject(Router);
  const authenticated = await auth.refreshSession();
  return authenticated ? true : router.parseUrl('/internal/login');
};
