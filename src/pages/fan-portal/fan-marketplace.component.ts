
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { CartService } from '../../services/cart.service';
import { MarketplaceListing } from '../../types';

interface TradeOffer {
  id: string;
  type: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'rejected' | 'countered';
  offeredDevice: any;
  requestedDevice: any;
  fromUser?: string;
  toUser?: string;
  cashAdjustment: number;
  rejectedAt?: Date;
  // For UI
  timeLeft?: string;
}

@Component({
  selector: 'app-fan-marketplace',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule],
  templateUrl: './fan-marketplace.component.html',
})
export class FanMarketplaceComponent {
  private dataService = inject(DataService);
  deviceService = inject(DeviceConnectionService);
  private userService = inject(UserService);
  cartService = inject(CartService);

  activeTab = signal<'my-listings' | 'buy-devices' | 'trades'>('buy-devices');

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
  showDeviceDetailModal = signal<MarketplaceListing | null>(null);
  detailTab = signal<'tracks' | 'capsules'>('tracks');

  selectedDeviceDetails = computed(() => {
    const selectedListing = this.showDeviceDetailModal();
    if (!selectedListing) return null;
    
    const album = this.dataService.getAlbum(selectedListing.albumId)();
    return {
      listing: selectedListing,
      album: album
    };
  });

  // "Make Offer" state
  showOfferModal = signal<MarketplaceListing | null>(null);
  offerPrice = signal(0);

  // "Trades" state
  showCounterModal = signal<any | null>(null);
  counterOfferAmount = signal(0);
  showFinalizeModal = signal<TradeOffer | null>(null);

  tradeOffers = signal<TradeOffer[]>([
    {
      id: 'TRADE-1',
      type: 'incoming',
      status: 'pending',
      offeredDevice: {
        albumTitle: 'Cosmic Drift',
        albumArtist: 'Stellar Phase',
        deviceId: 'DPA-MOCK-NEW1',
        artworkUrl: 'https://picsum.photos/seed/cosmicdrift/400/400'
      },
      requestedDevice: {
        albumTitle: 'Midnight Horizons',
        albumArtist: '808 Dreams',
        deviceId: 'DPA-SIM-1234',
        artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
      },
      fromUser: '0xTR4D...3R',
      cashAdjustment: 20
    },
    {
      id: 'TRADE-2',
      type: 'outgoing',
      status: 'pending',
      offeredDevice: {
        albumTitle: 'Midnight Horizons',
        albumArtist: '808 Dreams',
        deviceId: 'DPA-SIM-1234',
        artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
      },
      requestedDevice: {
        albumTitle: 'Midnight Horizons',
        albumArtist: '808 Dreams',
        deviceId: 'DPA-MOCK-C0DE',
        artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
      },
      toUser: '0x9F8E...B6A7',
      cashAdjustment: -10
    },
    {
      id: 'TRADE-3',
      type: 'incoming',
      status: 'rejected',
      rejectedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      offeredDevice: {
        albumTitle: 'Future Funk Vol. 2',
        albumArtist: 'GrooveBot',
        deviceId: 'DPA-MOCK-FUNK',
        artworkUrl: 'https://picsum.photos/seed/futurefunk/400/400'
      },
      requestedDevice: {
        albumTitle: 'Midnight Horizons',
        albumArtist: '808 Dreams',
        deviceId: 'DPA-SIM-1234',
        artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
      },
      fromUser: '0xGR00...V3',
      cashAdjustment: 0
    },
    {
      id: 'TRADE-4',
      type: 'incoming',
      status: 'accepted',
      offeredDevice: {
        albumTitle: 'Ocean Drive',
        albumArtist: 'Synthwave Kid',
        deviceId: 'DPA-MOCK-OCEAN',
        artworkUrl: 'https://picsum.photos/seed/oceandrive/400/400'
      },
      requestedDevice: {
        albumTitle: 'Midnight Horizons',
        albumArtist: '808 Dreams',
        deviceId: 'DPA-SIM-1234',
        artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
      },
      fromUser: '0x5YN7...H',
      cashAdjustment: 0
    }
  ]);

  pendingIncomingTrades = computed(() => this.tradeOffers().filter(t => t.type === 'incoming' && t.status === 'pending'));
  pendingOutgoingTrades = computed(() => this.tradeOffers().filter(t => t.type === 'outgoing' && t.status === 'pending'));
  acceptedTrades = computed(() => this.tradeOffers().filter(t => t.status === 'accepted'));
  
  rejectedTrades = computed(() => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return this.tradeOffers()
      .filter(t => t.status === 'rejected' && t.rejectedAt && new Date(t.rejectedAt).getTime() > threeDaysAgo)
      .map(t => ({
        ...t,
        timeLeft: this.getRejectedTimeLeft(t.rejectedAt!)
      }));
  });

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

  addToCart(listing: MarketplaceListing) {
    this.cartService.addItem(listing);
  }

  makeOffer(listing: MarketplaceListing) {
    this.offerPrice.set(Math.floor(listing.priceUsd * 0.9)); // Default offer to 90%
    this.showOfferModal.set(listing);
  }
  
  submitOffer() {
    const listing = this.showOfferModal();
    if(listing) {
      alert(`Offer of $${this.offerPrice()} submitted for ${listing.albumTitle} (Device: ${listing.deviceId}). The seller has been notified.`);
      this.showOfferModal.set(null);
    }
  }

  acceptTrade(tradeId: string) {
    this.tradeOffers.update(offers => offers.map(o => o.id === tradeId ? { ...o, status: 'accepted' } : o));
  }
  
  rejectTrade(tradeId: string) {
    this.tradeOffers.update(offers => offers.map(o => o.id === tradeId ? { ...o, status: 'rejected', rejectedAt: new Date() } : o));
  }
  
  restoreTrade(tradeId: string) {
    this.tradeOffers.update(offers => offers.map(o => o.id === tradeId ? { ...o, status: 'pending', rejectedAt: undefined } : o));
  }

  openFinalizeModal(trade: TradeOffer) {
    this.showFinalizeModal.set(trade);
  }

  openDeviceDetailModal(listing: MarketplaceListing) {
    this.detailTab.set('tracks'); // Reset to first tab
    this.showDeviceDetailModal.set(listing);
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  confirmFinalization() {
    const trade = this.showFinalizeModal();
    if (trade) {
      alert(`Finalizing trade ${trade.id}... This would trigger the secure DPA ledger transfer and any cash payment.`);
      this.tradeOffers.update(offers => offers.filter(o => o.id !== trade.id));
      this.showFinalizeModal.set(null);
    }
  }

  counterOffer(trade: any) {
    this.counterOfferAmount.set(trade.cashAdjustment ? -trade.cashAdjustment : 10);
    this.showCounterModal.set(trade);
  }

  submitCounterOffer() {
    const trade = this.showCounterModal();
    if (trade) {
      const amount = this.counterOfferAmount();
      const action = amount >= 0 ? `offer an additional $${amount}` : `request an additional $${-amount}`;
      alert(`Counter offer for Trade ${trade.id} submitted. You now ${action}.`);
      this.showCounterModal.set(null);
    }
  }

  private getRejectedTimeLeft(rejectedAt: Date): string {
    const expiryTime = new Date(rejectedAt).getTime() + 3 * 24 * 60 * 60 * 1000;
    const timeLeftMs = expiryTime - Date.now();
    
    if (timeLeftMs <= 0) return 'Expired';
    
    const days = Math.floor(timeLeftMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} left`;
    return `${hours} hour${hours > 1 ? 's' : ''} left`;
  }
}
