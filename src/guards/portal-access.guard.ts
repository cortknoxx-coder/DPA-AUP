import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { UserService } from '../services/user.service';

type GuardedPortal = 'fan' | 'creator';

function checkPortalAccess(portal: GuardedPortal): true | UrlTree {
  const userService = inject(UserService);
  const router = inject(Router);
  return userService.canAccessPortal(portal)
    ? true
    : router.parseUrl(userService.deniedPortalRedirect(portal));
}

export const requireCreatorPortalGuard: CanActivateFn = () => checkPortalAccess('creator');
export const requireFanPortalGuard: CanActivateFn = () => checkPortalAccess('fan');
