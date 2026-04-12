
import { Injectable, computed, signal } from '@angular/core';
// FIX: Import UserProfile from the shared types file.
import { PaymentMethod, RegionStat, TopAsset, UserProfile, UserRole } from '../types';

export interface Financials {
  totalEarnings: number;
  currentBalance: number;
  royaltySource: number;  // Secondary market
  dpaSalesSource: number; // Primary hardware sales
  perksSource: number;    // DCNP digital sales
}

export interface EarningPoint {
  date: string;
  amount: number;
}

export interface PortalEntitlements {
  roles: UserRole[];
  licenseTier: 'none' | 'fan' | 'creator' | 'dual' | 'operator';
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly OPERATOR_PREVIEW_KEY = 'dpa_operator_preview';

  // Temporary scaffold until the real license/entitlement backend exists.
  // Default to dual-role so current internal testing can still use both portals.
  entitlements = signal<PortalEntitlements>({
    roles: ['fan', 'creator'],
    licenseTier: 'dual'
  });

  userProfile = signal<UserProfile>({
    name: 'Jane Doe',
    artistName: '808 Dreams',
    email: 'jane.doe@example.com'
  });

  financials = signal<Financials>({
    totalEarnings: 352840.21,
    currentBalance: 9430.75,
    royaltySource: 24260.19,
    dpaSalesSource: 311588.02,
    perksSource: 16992.00
  });

  paymentMethods = signal<PaymentMethod[]>([
    { id: 'pm_1', type: 'bank', name: 'Chase Checking', last4: '8842', isDefault: true }
  ]);

  earningsHistory = signal<EarningPoint[]>([
    { date: '2024-01-01', amount: 12000 },
    { date: '2024-02-01', amount: 15500 },
    { date: '2024-03-01', amount: 14200 },
    { date: '2024-04-01', amount: 18900 },
    { date: '2024-05-01', amount: 22400 },
    { date: '2024-06-01', amount: 21800 },
    { date: '2024-07-01', amount: 25600 },
    { date: '2024-08-01', amount: 29500 },
    { date: '2024-09-01', amount: 28100 },
    { date: '2024-10-01', amount: 32400 },
    { date: '2024-11-01', amount: 38900 },
    { date: '2024-12-01', amount: 42500 },
  ]);

  // Regional Data
  regionStats = signal<RegionStat[]>([
    { regionCode: 'US', regionName: 'United States', deviceSales: 1250, streamingSessions: 45000, revenue: 52000, percentage: 45 },
    { regionCode: 'JP', regionName: 'Japan', deviceSales: 840, streamingSessions: 32000, revenue: 38500, percentage: 28 },
    { regionCode: 'UK', regionName: 'United Kingdom', deviceSales: 420, streamingSessions: 15000, revenue: 18200, percentage: 14 },
    { regionCode: 'DE', regionName: 'Germany', deviceSales: 310, streamingSessions: 8000, revenue: 12400, percentage: 9 },
    { regionCode: 'BR', regionName: 'Brazil', deviceSales: 150, streamingSessions: 12000, revenue: 4500, percentage: 4 },
  ]);

  // Top Performers
  topAssets = signal<TopAsset[]>([
    { id: '1', title: 'Midnight Horizons', type: 'album', totalPlays: 124000, revenue: 62000, trend: 12.5 },
    { id: '2', title: 'Neon Rain', type: 'track', totalPlays: 54000, revenue: 8400, trend: 5.2 },
    { id: '3', title: 'Cyber Heart', type: 'track', totalPlays: 42000, revenue: 6100, trend: -2.1 },
    { id: '4', title: 'Echoes of Silence', type: 'album', totalPlays: 8000, revenue: 4200, trend: 150.0 }
  ]);

  constructor() {
    this.bootstrapOperatorPreview();
  }

  licensedRoles = computed(() => this.entitlements().roles);
  licenseTier = computed(() => this.entitlements().licenseTier);
  isDualPortalLicensed = computed(() => this.hasRole('fan') && this.hasRole('creator'));

  hasRole(role: UserRole): boolean {
    return this.licensedRoles().includes(role);
  }

  canAccessPortal(portal: UserRole): boolean {
    return this.hasRole(portal);
  }

  bestAvailableRoute(): string {
    if (this.canAccessPortal('creator')) return '/artist/connect';
    if (this.canAccessPortal('fan')) return '/fan';
    if (this.canAccessPortal('operator')) return '/internal/ingest';
    return '/login';
  }

  deniedPortalRedirect(portal: UserRole): string {
    const fallback = this.bestAvailableRoute();
    if (portal === 'creator' && this.canAccessPortal('fan')) return '/fan';
    if (portal === 'fan' && this.canAccessPortal('creator')) return '/artist/connect';
    if (portal === 'operator' && this.canAccessPortal('creator')) return '/artist/connect';
    if (portal === 'operator' && this.canAccessPortal('fan')) return '/fan';
    return fallback;
  }

  portalAccessMessage(portal: UserRole): string {
    if (portal === 'creator') {
      return 'Creator access requires a creator or dual-role license.';
    }
    if (portal === 'fan') {
      return 'Fan access requires a fan or dual-role license.';
    }
    return 'Operator access requires internal preview to be enabled.';
  }

  setEntitlements(entitlements: PortalEntitlements) {
    const roles = Array.from(new Set(entitlements.roles));
    this.entitlements.set({ ...entitlements, roles });
  }

  enableOperatorPreview() {
    this.persistOperatorPreview(true);
    this.entitlements.update((current) => ({
      ...current,
      roles: Array.from(new Set([...current.roles, 'operator'])),
    }));
  }

  disableOperatorPreview() {
    this.persistOperatorPreview(false);
    this.entitlements.update((current) => ({
      ...current,
      roles: current.roles.filter((role) => role !== 'operator'),
    }));
  }

  updateProfile(profile: UserProfile) {
    this.userProfile.set(profile);
    // In a real app, this would be an API call.
  }

  addPaymentMethod(method: Omit<PaymentMethod, 'id'>) {
    const newMethod: PaymentMethod = {
      ...method,
      id: Math.random().toString(36).substr(2, 9)
    };
    
    this.paymentMethods.update(current => {
      if (newMethod.isDefault || current.length === 0) {
        return [...current.map(m => ({...m, isDefault: false})), {...newMethod, isDefault: true}];
      }
      return [...current, newMethod];
    });
  }

  deletePaymentMethod(methodId: string) {
    this.paymentMethods.update(current => {
      const toDelete = current.find(m => m.id === methodId);
      const remaining = current.filter(m => m.id !== methodId);
      // If we delete the default method, make the first remaining one the new default
      if (toDelete?.isDefault && remaining.length > 0) {
        remaining[0].isDefault = true;
      }
      return remaining;
    });
  }

  setDefaultPaymentMethod(methodId: string) {
    this.paymentMethods.update(current => 
      current.map(m => ({
        ...m,
        isDefault: m.id === methodId
      }))
    );
  }

  withdraw(amount: number) {
    this.financials.update(f => ({
      ...f,
      currentBalance: f.currentBalance - amount
    }));
  }

  recordTransaction(amount: number) {
    // Simulate instant payout to artist balance from capsule sales
    this.financials.update(f => ({
      ...f,
      currentBalance: f.currentBalance + amount,
      totalEarnings: f.totalEarnings + amount,
      perksSource: f.perksSource + amount
    }));
  }

  private bootstrapOperatorPreview() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('internalPreview') === '1') {
      this.enableOperatorPreview();
      return;
    }
    if (window.localStorage.getItem(this.OPERATOR_PREVIEW_KEY) === '1') {
      this.entitlements.update((current) => ({
        ...current,
        roles: Array.from(new Set([...current.roles, 'operator'])),
      }));
    }
  }

  private persistOperatorPreview(enabled: boolean) {
    if (typeof window === 'undefined') return;
    if (enabled) {
      window.localStorage.setItem(this.OPERATOR_PREVIEW_KEY, '1');
    } else {
      window.localStorage.removeItem(this.OPERATOR_PREVIEW_KEY);
    }
  }
}
