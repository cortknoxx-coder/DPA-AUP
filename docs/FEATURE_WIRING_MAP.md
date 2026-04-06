# DPA Portal — Feature Wiring Map

This document captures every feature pathway that existed in the mock data,
what each one powers in the UI, and its current wiring status.

Use this as your checklist when implementing. When a feature gets wired to
real data (device firmware, creator input, or backend API), update the status.

---

## Legend

| Status | Meaning |
|--------|---------|
| **WIRED** | Connected to live data (device firmware or creator input) |
| **EMPTY** | Structural placeholder exists, no mock data, needs real data source |
| **STUB** | Component exists but feature logic is incomplete |
| **NOT STARTED** | No implementation yet |

---

## CREATOR PORTAL (`/artist/...`)

### 1. Dashboard (`/artist/dashboard`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Album list | `DataService.albums` | **WIRED** | Shows creator's albums from localStorage; tracks come from device when WiFi connected |
| Create new album | `DataService.createAlbum()` | **WIRED** | Creates empty album shell |

### 2. Metadata Tab (`/artist/albums/:id/metadata`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Album title | `Album.title` | **WIRED** | Persists to localStorage + pushes to device SSID |
| Artist name | `Album.artistName` | **WIRED** | Pushes to device NVS for dynamic SSID |
| Genre | `Album.genre` | **EMPTY** | Field exists, user fills in |
| Record label | `Album.recordLabel` | **EMPTY** | Field exists, user fills in |
| Copyright | `Album.copyright` | **EMPTY** | Field exists, user fills in |
| Release date | `Album.releaseDate` | **EMPTY** | Field exists, user fills in |
| UPC/EAN code | `Album.upcCode` | **EMPTY** | Field exists, user fills in |
| Parental advisory | `Album.parentalAdvisory` | **EMPTY** | Checkbox exists |
| Description | `Album.description` | **EMPTY** | Textarea exists |
| Release type | `Album.skuType` | **EMPTY** | Dropdown exists |

### 3. Tracks Tab (`/artist/albums/:id/tracks`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Track list display | `DeviceWifiService.getDeviceTracks()` | **WIRED** | Live from `/api/audio/tracks` when WiFi connected |
| Play counts | `DeviceWifiService.getAnalytics()` | **WIRED** | Path-based matching from `/api/analytics` |
| Upload WAV to device | `DeviceWifiService.uploadFileToPath()` | **WIRED** | Multipart upload via port 81 sync server |
| Play on device | `DeviceWifiService.playFile()` | **WIRED** | Triggers firmware playback |
| Stop playback | `DeviceWifiService.sendCommand(0x02)` | **WIRED** | Sends pause command |
| Delete from device | `DeviceWifiService.deleteFile()` | **WIRED** | HTTP DELETE to firmware |
| Format badge (bit/kHz) | `DeviceTrack.sampleRate/bitsPerSample` | **WIRED** | From firmware track scan |

### 4. Booklet Tab (`/artist/albums/:id/booklet`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Credits text | `Album.booklet.credits` | **EMPTY** | Was mock "PRODUCED BY 808 DREAMS..." — textarea exists |
| Gallery images | `Album.booklet.gallery[]` | **EMPTY** | Was 4 picsum URLs — upload UI exists |
| Booklet videos | `Album.booklet.videos[]` | **EMPTY** | Was 2 sample videos — upload UI exists |
| Lyrics / liner notes | `Album.lyrics` | **EMPTY** | Was mock lyrics for "Neon Rain" + "Cyber Heart" — textarea exists |

### 5. Theme & LED Tab (`/artist/albums/:id/theme`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Album colors | `Theme.albumColor` | **WIRED** | Pushes to device via `/api/theme` |
| LED idle/playback/charging | `Theme.led` | **WIRED** | Pushes to device, mirrors firmware |
| LED patterns (29 total) | Firmware `led.h` | **WIRED** | Full pattern list synced |
| DCNP notification colors | `Theme.dcnp` | **WIRED** | 6 event-type colors |
| Skin/wrap image | `Theme.skinImage` | **STUB** | Field exists, upload UI exists, not pushed to device |
| Brightness control | Firmware `/api/theme` | **WIRED** | Slider pushes to device |

### 6. Perks / DCNP Tab (`/artist/albums/:id/perks`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Create DCNP event | `DcnpEvent` interface | **WIRED** | Creates event, pushes capsule to device |
| Event types | concert/video/merch/signing/remix/other | **WIRED** | All 6 types defined |
| Push capsule to device | `DeviceWifiService.pushCapsule()` | **WIRED** | POST to `/api/capsule` |
| Capsule persistence | Firmware `/data/capsules.json` | **WIRED** | Saves to SD, survives reboot |
| Event list display | `Album.dcnpEvents[]` | **EMPTY** | Was 5 mock events — array starts empty, filled by creator |
| Event delivery status | `DcnpEvent.status` | **STUB** | UI shows status but no real delivery tracking yet |

### 7. Pricing Tab (`/artist/albums/:id/pricing`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Retail price | `Album.pricing.retailPrice` | **EMPTY** | Was $79 — field exists |
| Currency | `Album.pricing.currency` | **EMPTY** | Was USD — field exists |
| Royalty calculator | Computed in component | **STUB** | UI exists, no real transaction data |

### 8. Devices Tab (`/artist/albums/:id/devices`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Unit economics | `Album.economics` (was `UnitEconomics`) | **EMPTY** | Was mock 5000 mfg / 4210 sold — all zeroed |
| Resale transactions | `Album.resales[]` (was `ResaleTransaction[]`) | **EMPTY** | Was 45 mock resales — array starts empty |
| Device fleet list | `FleetService` | **STUB** | Component exists, generates mock dots on map |

### 9. Overview Tab (`/artist/albums/:id/overview`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Project stats | `Album` fields | **WIRED** | Shows track count, status |
| Device info card | `FirmwareStatus` | **WIRED** | Live DUID, firmware version, storage when WiFi connected |

### 10. Fleet Tracker (`/artist/fleet`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| KPIs | `FleetService.getKpis()` | **STUB** | Returns mock computed values |
| Device map | `FleetService` | **STUB** | Plots mock dots on world map |
| Activity feed | `FleetService.getActivityFeed()` | **STUB** | Generates mock events |
| Track names in feed | `FleetService.trackNames[]` | **EMPTY** | Was mock names — now generic placeholders |

### 11. Account (`/artist/account`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| User profile | `UserService.userProfile` | **EMPTY** | Was "Jane Doe" / "808 Dreams" — now empty, user fills in |
| Financials | `UserService.financials` | **EMPTY** | Was $352K total — now zeroed |
| Earnings history | `UserService.earningsHistory[]` | **EMPTY** | Was 12 monthly data points — now empty |
| Region stats | `UserService.regionStats[]` | **EMPTY** | Was 5 regions — now empty |
| Top assets | `UserService.topAssets[]` | **EMPTY** | Was 4 mock items — now empty |
| Payment methods | `UserService.paymentMethods[]` | **EMPTY** | Was 1 mock bank — now empty |

---

## FAN PORTAL (`/fan/...`)

### 12. Fan Home (`/fan/app/home`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| Album display | `DeviceConnectionService.deviceLibrary()` | **WIRED** | Shows device album when connected |
| Track list | `DeviceWifiService.getDeviceTracks()` | **WIRED** | Live tracks from device storage |
| Connection options | `/fan/auth` page | **WIRED** | WiFi, BLE, NFC, USB Bridge, Simulator |

### 13. Fan Album Detail (`/fan/app/album/:id`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| Track playback | `DeviceWifiService.playFile()` | **WIRED** | Plays on device, polls status |
| Play counts / popularity | `DeviceWifiService.getAnalytics()` | **WIRED** | Path-based matching |
| Favorites / hearts | `DeviceWifiService.setFavorite()` | **WIRED** | Syncs with firmware favorites |
| Album artwork | `Album.artworkUrl` or default | **WIRED** | Falls back to default cover |

### 14. Fan Capsules (`/fan/app/capsules`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| Capsule list | `DeviceWifiService.getCapsules()` | **WIRED** | Fetches from `/api/capsules` |
| Capsule transfer | `CryptoService.encryptForDevice()` | **WIRED** | AES-GCM encrypted, pushed to device |
| DCNP notifications | `LedNotificationService` | **WIRED** | LED color flash on capsule receive |

### 15. Fan Marketplace (`/fan/app/marketplace`)
| Feature | Data Source (was mock) | Status | Notes |
|---------|----------------------|--------|-------|
| Buy devices listing | `DataService.marketplaceListings[]` | **EMPTY** | Was 3 mock listings — now empty |
| Sell your device | `FanMarketplaceComponent` | **STUB** | UI exists, no real transaction backend |
| Trade offers | `FanMarketplaceComponent.tradeOffers[]` | **EMPTY** | Was 4 mock trades — now empty |
| Cart / checkout | `CartService` | **STUB** | Service exists, no payment gateway |

### 16. Fan Device Registration (`/fan/app/devices`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| Device registration | `DeviceConnectionService` | **WIRED** | Registers DUID |
| NFC tag write | `DeviceNfcService.writeTag()` | **WIRED** | Writes DUID to NFC tag |
| LED settings mirror | Firmware `/api/status` | **WIRED** | Mirrors firmware LED state |
| LED control | Firmware `/api/theme` | **WIRED** | Pushes changes to device |
| Unregister device | Component method | **STUB** | UI exists, no backend |
| Report lost/stolen | Component method | **STUB** | UI exists, no backend |

### 17. Fan Settings (`/fan/app/settings`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| Notification preferences | Local state | **STUB** | Toggles exist, no persistence |
| Audio quality | Local state | **STUB** | Selector exists, no effect on playback |

### 18. Fan Audio (`/fan/app/audio`)
| Feature | Data Source | Status | Notes |
|---------|-----------|--------|-------|
| EQ controls | `DeviceWifiService` | **STUB** | UI exists, pushes to device |

---

## FIRMWARE FEATURES (device-side, accessed via portal)

| Feature | Endpoint | Status | Notes |
|---------|----------|--------|-------|
| Playback control | `/api/cmd`, `/api/audio/play` | **WIRED** | Play/pause/next/prev/stop |
| Track listing | `/api/audio/tracks` | **WIRED** | Lists DPA + WAV files with metadata |
| Analytics | `/api/analytics` | **WIRED** | Play counts persist to SD |
| Favorites | `/api/favorites`, `/api/favorites/set` | **WIRED** | Persist to SD |
| Theme/LED | `/api/theme` | **WIRED** | NVS persistence |
| Capsule push | `/api/capsule` | **WIRED** | Saves to `/data/capsules.json` |
| File upload | Port 81 sync server | **WIRED** | Buffered write with isolation |
| Album + track art | `GET /api/art?path=/art/...` | **WIRED** | Serves JPG/PNG/WEBP under `/art/` only; portal pushes `cover.jpg`, `TrackStem.jpg` |
| File delete | `/api/sd/delete` | **WIRED** | DELETE by path |
| Storage info | `/api/storage` | **WIRED** | Total/used/free MB |
| Status | `/api/status` | **WIRED** | Full device state JSON |
| Volume | `/api/volume` | **WIRED** | 0-100 |
| EQ preset | `/api/eq` | **WIRED** | flat/bass/vocal/warm |
| Admin unlock | `/api/admin/unlock` | **WIRED** | DUID-based |
| Dynamic SSID | NVS `dpa_meta` | **WIRED** | Artist-Album-DPA format |
| DPA format playback | `audio.h` | **WIRED** | DPA1 container + WAV/float32 |
| A2DP Bluetooth | — | **NOT STARTED** | Classic BT audio out |
| OTA firmware update | — | **NOT STARTED** | Over-the-air update |
| ESP-NOW mesh | `espnow_mesh.h` | **STUB** | Scaffolded but disabled |

---

## WHAT NEEDS REAL DATA SOURCES

These features have UI but need a backend or real data to be useful:

1. **UserService** (Account tab) — needs auth + user API
2. **FleetService** (Fleet tracker) — needs device telemetry API
3. **Marketplace** — needs transaction/listing backend
4. **Resales / Economics** — needs sales tracking backend
5. **Booklet** — needs file upload storage (images, videos)
6. **Payment methods** — needs payment gateway (Stripe etc.)
7. **Earnings / Payouts** — needs financial backend

These are Phase 6+ features that require actual backend infrastructure.
