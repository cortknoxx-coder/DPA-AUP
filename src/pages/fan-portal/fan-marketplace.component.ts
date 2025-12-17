
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { MarketplaceListing } from '../../types';

@Component({
  selector: 'app-fan-marketplace',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule],
  template: `
    <div class="space-y-8 pb-20">
      <header>
        <h1 class="text-4xl font-bold text-white tracking-tight">Marketplace</h1>
        <p class="text-slate-400 mt-2">Trade verified DPA devices on the official secondary market.</p>
      </header>

      <!-- Tab Navigation -->
      <div class="border-b border-slate-800">
        <nav class="-mb-px flex space-x-8">
          <button 
            (click)="activeTab.set('my-listings')"
            [class.border-indigo-500]="activeTab() === 'my-listings'"
            [class.text-indigo-400]="activeTab() === 'my-listings'"
            class="whitespace-nowrap border-b-2 border-transparent px-1 pb-4 text-sm font-medium text-slate-400 hover:text-slate-200">
            My Listings
          </button>
          <button 
            (click)="activeTab.set('buy-devices')"
            [class.border-indigo-500]="activeTab() === 'buy-devices'"
            [class.text-indigo-400]="activeTab() === 'buy-devices'"
            class="whitespace-nowrap border-b-2 border-transparent px-1 pb-4 text-sm font-medium text-slate-400 hover:text-slate-200">
            Buy Devices
          </button>
        </nav>
      </div>

      <!-- MY LISTINGS TAB -->
      @if (activeTab() === 'my-listings') {
        <div class="animate-fade-in-up">
          @if(userDevice(); as device) {
            <div class="rounded-xl bg-slate-900/50 border border-slate-800 p-6">
              <div class="flex flex-col md:flex-row gap-6">
                <div class="w-40 h-24 rounded-lg bg-gradient-to-br from-slate-200 to-slate-400 shadow-xl border border-slate-500/50 flex items-center justify-center relative shrink-0">
                  <div class="absolute inset-y-0 left-0 w-1.5 bg-emerald-500 blur-sm"></div>
                  <span class="text-[10px] font-bold text-slate-600">{{ device.model }}</span>
                </div>
                <div class="flex-1">
                  <div class="text-xs text-slate-500 uppercase tracking-wider">Your Device</div>
                  <div class="text-lg font-mono font-bold text-white tracking-wide mt-1">{{ device.serial }}</div>
                  @if (userListing(); as listing) {
                    <div class="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                       <div class="text-xs text-emerald-400 font-bold uppercase tracking-wider">Listed for Sale</div>
                       <div class="flex items-end justify-between mt-2">
                          <span class="text-3xl font-bold text-white">{{ listing.priceUsd | currency }}</span>
                          <button (click)="delist()" class="rounded bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500">Delist</button>
                       </div>
                    </div>
                  } @else {
                    <p class="text-sm text-slate-400 mt-2">This device is currently in your possession. You can list it on the marketplace for other fans to purchase.</p>
                    <button (click)="showSellModal.set(true)" class="mt-4 rounded bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20">
                      Sell Device
                    </button>
                  }
                </div>
              </div>
            </div>
          } @else {
            <div class="text-center py-20 rounded-xl border border-dashed border-slate-800">
              <h3 class="text-slate-200 font-semibold">No Device Connected</h3>
              <p class="text-sm text-slate-500 mt-1">Please connect your DPA device to manage your listings.</p>
            </div>
          }
        </div>
      }

      <!-- BUY DEVICES TAB -->
      @if (activeTab() === 'buy-devices') {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up">
          @for(listing of listings(); track listing.id) {
            <div class="group relative rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
              <img [src]="listing.artworkUrl" class="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300">
              <div class="p-4 space-y-3">
                <h3 class="font-bold text-white truncate">{{ listing.albumTitle }}</h3>
                <div class="text-xs text-slate-400">
                  <span class="font-semibold text-slate-300">{{ listing.albumArtist }}</span>
                  <span class="text-slate-600 mx-1">•</span>
                  <span>Device ID: <span class="font-mono">{{ listing.deviceId }}</span></span>
                </div>
                <div class="flex justify-between items-center pt-3 border-t border-slate-800">
                  <span class="text-xl font-bold text-indigo-400">{{ listing.priceUsd | currency }}</span>
                  <button (click)="buy(listing)" class="rounded-full bg-slate-800 text-slate-300 text-xs font-bold px-4 py-2 hover:bg-indigo-600 hover:text-white transition-colors">
                    Buy Now
                  </button>
                </div>
              </div>
            </div>
          } @empty {
            <div class="col-span-full text-center py-20 rounded-xl border border-dashed border-slate-800">
              <h3 class="text-slate-200 font-semibold">Marketplace is Empty</h3>
              <p class="text-sm text-slate-500 mt-1">No devices are currently listed for sale.</p>
            </div>
          }
        </div>
      }
    </div>

    <!-- Sell Modal -->
    @if (showSellModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" (click)="showSellModal.set(false)">
        <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 shadow-2xl animate-fade-in-up p-6" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-bold text-white">List Your Device for Sale</h3>
          <p class="text-sm text-slate-400 mt-1">Set your price and see the potential payout.</p>

          <div class="my-6">
            <label class="block text-xs text-slate-400 mb-1">Asking Price (USD)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input type="number" [(ngModel)]="askingPrice" min="1" class="w-full rounded-lg bg-slate-900 border border-slate-700 pl-8 pr-3 py-3 text-2xl text-white font-bold focus:border-indigo-500 outline-none">
            </div>
          </div>

          <div class="space-y-3 rounded-lg bg-slate-900 border border-slate-800 p-4">
            <div class="flex justify-between text-sm"><span class="text-slate-400">Marketplace Fee (5%)</span><span>-{{ marketplaceFee() | currency }}</span></div>
            <div class="flex justify-between text-sm"><span class="text-slate-400">Artist Royalty (10%)</span><span>-{{ artistRoyalty() | currency }}</span></div>
            <div class="border-t border-slate-700/50 pt-3 flex justify-between">
              <span class="font-bold text-slate-300">Your Payout</span>
              <span class="font-bold text-emerald-400">{{ yourPayout() | currency }}</span>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button (click)="showSellModal.set(false)" class="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
            <button (click)="listDevice()" class="rounded bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500">List for Sale</button>
          </div>
        </div>
      </div>
    }
  `
})
export class FanMarketplaceComponent {
  private dataService = inject(DataService);
  deviceService = inject(DeviceConnectionService);
  private userService = inject(UserService);

  activeTab = signal<'my-listings' | 'buy-devices'>('my-listings');

  // "My Listings" state
  userDevice = computed(() => this.deviceService.deviceInfo());
  userListing = computed(() => {
    const deviceId = this.userDevice()?.serial;
    if (!deviceId) return null;
    return this.dataService.marketplaceListings().find(l => l.deviceId === deviceId);
  });

  showSellModal = signal(false);
  askingPrice = signal(100);

  marketplaceFee = computed(() => this.askingPrice() * 0.05);
  artistRoyalty = computed(() => this.askingPrice() * 0.10);
  yourPayout = computed(() => this.askingPrice() - this.marketplaceFee() - this.artistRoyalty());

  // "Buy Devices" state
  listings = this.dataService.marketplaceListings;

  listDevice() {
    const device = this.userDevice();
    const album = this.deviceService.deviceLibrary()?.albums[0];
    if (!device || !album) {
      alert("Error: Could not find device or album information.");
      return;
    }

    const newListing: MarketplaceListing = {
      id: `LST-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      deviceId: device.serial,
      albumId: album.id,
      albumTitle: album.title,
      albumArtist: this.userService.userProfile().artistName, // Mock artist name
      sellerHash: `0x${this.userService.userProfile().name.slice(0,4)}...`, // Mock hash
      priceUsd: this.askingPrice(),
      artworkUrl: `https://picsum.photos/seed/${album.id}/400/400`
    };

    this.dataService.listDeviceForSale(newListing);
    this.showSellModal.set(false);
  }

  delist() {
    const listing = this.userListing();
    if (listing) {
      this.dataService.delistDevice(listing.deviceId);
    }
  }

  buy(listing: MarketplaceListing) {
    if (confirm(`Are you sure you want to buy this device for ${listing.priceUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}?`)) {
      this.dataService.buyDevice(listing.id);
      alert("Purchase successful! Ownership transfer initiated.");
    }
  }
}
