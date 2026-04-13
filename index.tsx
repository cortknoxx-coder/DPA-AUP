import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation, withComponentInputBinding } from '@angular/router';
import { AppComponent } from './src/app.component';
import { routes } from './src/app.routes';
import { inject } from '@vercel/analytics';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation(), withComponentInputBinding())
  ]
}).catch((err) => console.error(err));

// Initialize Vercel Web Analytics
inject();

// AI Studio always uses an `index.tsx` file for all project types.
