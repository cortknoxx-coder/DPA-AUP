import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { UserService } from '../services/user.service';
import { UserRole } from '../types';
import { InternalOperatorAuthService } from '../services/internal-operator-auth.service';

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
export const requireOperatorPortalGuard: CanActivateFn = async () => {
  const auth = inject(InternalOperatorAuthService);
  const router = inject(Router);
  const authenticated = await auth.refreshSession();
  return authenticated ? true : router.parseUrl('/internal/login');
};
