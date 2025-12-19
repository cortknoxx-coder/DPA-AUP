
import { Component, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-fan-checkout',
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
  template: `
    <div class="max-w-5xl mx-auto space-y-8 pb-20">
      <header>
        <h1 class="text-4xl font-bold text-white tracking-tight">Checkout</h1>
        <p class="text-slate-400 mt-2">Secure your piece of music history.</p>
      </header>

      @if(cartService.itemCount() > 0) {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
        
        <!-- Left Side: Shipping & Payment -->
        <div class="space-y-8">
          
          <!-- Shipping Address -->
          <section class="space-y-4">
            <h2 class="text-lg font-semibold text-white">Shipping Information</h2>
            <div class="grid grid-cols-2 gap-4">
              <div class="col-span-2"><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="Full Name"></div>
              <div class="col-span-2"><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="Address"></div>
              <div><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="City"></div>
              <div><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="State / Province"></div>
              <div><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="ZIP / Postal Code"></div>
              <div><input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="Country"></div>
            </div>
          </section>

          <!-- Payment -->
          <section class="space-y-4">
            <h2 class="text-lg font-semibold text-white">Payment Method</h2>
            
            <!-- Express Pay -->
            <div class="grid grid-cols-2 gap-4">
               <button class="w-full h-12 rounded-lg bg-black flex items-center justify-center text-white font-semibold text-lg hover:bg-gray-800 transition-colors"><span class="font-sans">Pay</span></button>
               <button class="w-full h-12 rounded-lg bg-white flex items-center justify-center text-black font-semibold text-lg hover:bg-gray-200 transition-colors">
                  <svg class="w-8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12.1 9.38v5.25h1.52V9.38h-1.52zm5.72 2.62c0-1.5-1.04-2.4-2.4-2.4-1.39 0-2.39 1-2.39 2.45s.96 2.41 2.44 2.41c1.35 0 2.35-.91 2.35-2.46zm-1.55 0c0 .87-.57 1.42-1.4 1.42-.81 0-1.35-.5-1.35-1.42 0-.88.54-1.41 1.39-1.41.83 0 1.36.52 1.36 1.41zm-9.33 0c0-1.45.98-2.43 2.32-2.43 1.35 0 2.3.96 2.3 2.4 0 1.45-.95 2.43-2.3 2.43-1.34 0-2.32-.98-2.32-2.4zm4.1-1.34c-.02-.8-.5-1.32-1.25-1.32-.76 0-1.27.5-1.27 1.35s.48 1.34 1.27 1.34c.75 0 1.25-.53 1.25-1.37z" fill="currentColor"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/></svg>Pay
               </button>
            </div>
            
            <div class="text-center text-xs text-slate-500 my-4">OR</div>
            
            <!-- Credit Card -->
            <div class="space-y-3">
              <input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="Card Number">
              <div class="grid grid-cols-2 gap-3">
                <input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="MM / YY">
                <input class="w-full bg-slate-800 border-slate-700 rounded p-2 text-sm" placeholder="CVC">
              </div>
            </div>
          </section>
        </div>

        <!-- Right Side: Order Summary -->
        <div class="space-y-6">
          <div class="rounded-xl bg-slate-900 border border-slate-800 p-6">
            <h2 class="text-lg font-semibold text-white mb-4">Order Summary</h2>
            <div class="space-y-4 border-b border-slate-800 pb-4">
              @for(item of cartService.items(); track item.id) {
                <div class="flex items-center gap-4">
                  <img [src]="item.artworkUrl" class="w-12 h-12 rounded object-cover">
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-white truncate">{{ item.albumTitle }}</div>
                    <div class="text-xs text-slate-400">Device: <span class="font-mono">{{ item.deviceId }}</span></div>
                  </div>
                  <div class="text-sm font-medium text-slate-300">{{ item.priceUsd | currency }}</div>
                </div>
              }
            </div>

            <div class="space-y-2 text-sm mt-4">
              <div class="flex justify-between text-slate-400"><span>Subtotal</span><span>{{ cartService.subtotal() | currency }}</span></div>
              <div class="flex justify-between text-slate-400"><span>Shipping</span><span>{{ cartService.shipping() | currency }}</span></div>
              <div class="flex justify-between text-slate-400"><span>Taxes</span><span>{{ cartService.tax() | currency }}</span></div>
              <div class="flex justify-between font-bold text-white text-base pt-2 border-t border-slate-700 mt-2"><span>Total</span><span>{{ cartService.total() | currency }}</span></div>
            </div>
          </div>
          <button (click)="placeOrder()" class="w-full rounded-lg bg-indigo-600 px-4 py-4 text-sm font-semibold text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20">
            Place Order
          </button>
        </div>
        </div>
      } @else {
        <div class="text-center py-20 rounded-xl border border-dashed border-slate-800">
            <h3 class="text-slate-200 font-semibold">Your cart is empty</h3>
            <p class="text-sm text-slate-500 mt-1">Add items from the marketplace to get started.</p>
        </div>
      }
    </div>
  `,
})
export class FanCheckoutComponent {
  cartService = inject(CartService);
  private router = inject(Router);

  placeOrder() {
    if (this.cartService.itemCount() === 0) return;

    alert('Order placed successfully! This is a simulation. A receipt has been sent to your email and the seller has been notified to ship your device.');
    this.cartService.clearCart();
    this.router.navigate(['/fan/home']);
  }
}
