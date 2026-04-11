
import { Injectable, signal, computed } from '@angular/core';
import { MarketplaceListing } from '../types';

@Injectable({ providedIn: 'root' })
export class CartService {
  items = signal<MarketplaceListing[]>([]);

  itemCount = computed(() => this.items().length);
  subtotal = computed(() => this.items().reduce((sum, item) => sum + item.priceUsd, 0));
  shipping = computed(() => this.itemCount() > 0 ? 15.00 : 0);
  tax = computed(() => this.subtotal() * 0.08); // 8% tax
  total = computed(() => this.subtotal() + this.shipping() + this.tax());

  addItem(item: MarketplaceListing) {
    if (this.items().some(i => i.id === item.id)) {
      console.warn('Item already in cart');
      return;
    }
    this.items.update(current => [...current, item]);
  }

  removeItem(itemId: string) {
    this.items.update(current => current.filter(item => item.id !== itemId));
  }

  clearCart() {
    this.items.set([]);
  }

  isInCart(itemId: string): boolean {
    return this.items().some(i => i.id === itemId);
  }
}
