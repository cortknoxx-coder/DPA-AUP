# DPA Device Hardware Wiring Guide

**DPA** (Digital Playback Asset) — brought to you by **The DPAC** (Digital Playback Asset Consortium)

**Firmware:** v1.0.0 | **MCU:** ESP32-WROVER-32 (also compatible with WROOM-32)

---

## Bill of Materials

| Component | Part | Notes |
|-----------|------|-------|
| MCU | ESP32-WROVER-32 DevKit | 4MB Flash + 4MB PSRAM (WROVER) or 4MB Flash (WROOM) |
| DAC | PCM5122 I2S DAC Module | 24-bit / 192kHz, I2C config at 0x4C |
| LED Strip | WS2812B COB Strip (60 LEDs) | 5V data, level shifter recommended |
| SPI Flash SD Card | Adafruit XTSD #6039 (4GB) | SPI interface, 3V/5V (onboard regulator + level shifter) |
| NFC Module | PN532 NFC/RFID | I2C mode (shared bus with DAC) |
| Buttons (x5) | 6mm Tactile Momentary | Play, Pause, Next, Prev, Mode |
| Battery | 3.7V LiPo (2000mAh+) | JST-PH connector |
| Voltage Divider | 2x 100K resistors | Battery monitoring on ADC |
| Capacitors | 10uF + 100nF | Decoupling for DAC + ADC |
| Level Shifter | 3.3V to 5V (1-ch) | WS2812B data line (optional but recommended) |

---

## Pin Assignment Table

| GPIO | Function | Direction | Component | Bus | Notes |
|------|----------|-----------|-----------|-----|-------|
| **4** | I2S BCLK | OUT | PCM5122 BCK | I2S | Bit clock |
| **5** | LED Data | OUT | WS2812B DIN | — | Level shift to 5V recommended |
| **12** | SD MISO | IN | XTSD MISO | HSPI | |
| **13** | SD MOSI | OUT | XTSD MOSI | HSPI | |
| **14** | SD SCK | OUT | XTSD SCK | HSPI | |
| **15** | SD CS | OUT | XTSD CS | HSPI | |
| **19** | I2S LRCLK | OUT | PCM5122 LRCK | I2S | Word select (L/R) |
| **21** | I2C SDA | I/O | PCM5122 + PN532 | I2C | Shared bus, 4.7K pull-up |
| **22** | I2C SCL | OUT | PCM5122 + PN532 | I2C | Shared bus, 4.7K pull-up |
| **23** | I2S DOUT | OUT | PCM5122 DIN | I2S | Audio data |
| **25** | Button: Play | IN | Tactile switch | — | Internal pull-up, active LOW |
| **26** | Button: Pause | IN | Tactile switch | — | Internal pull-up, active LOW |
| **27** | Button: Next | IN | Tactile switch | — | Internal pull-up, active LOW |
| **32** | Button: Prev | IN | Tactile switch | — | Internal pull-up, active LOW |
| **33** | Button: Mode | IN | Tactile switch | — | Internal pull-up, active LOW |
| **34** | Battery ADC | IN | Voltage divider | ADC1 | Input-only pin, no pull-up |

### Reserved / Unavailable Pins

| GPIO | Reason |
|------|--------|
| 0 | Boot strapping (BOOT button) |
| 1 | UART TX (Serial output) |
| 2 | Boot strapping (onboard LED on some boards) |
| 3 | UART RX (Serial input) |
| 6-11 | Internal SPI flash (do NOT use) |
| 16 | PSRAM on WROVER (do NOT use) |
| 17 | PSRAM on WROVER (do NOT use) |
| 34-39 | Input-only (no internal pull-up, no output) |

> **WROVER Note:** GPIO 16 and 17 are occupied by the PSRAM chip on WROVER modules. This firmware avoids both pins entirely, making it compatible with WROVER and WROOM variants.

---

## Wiring Diagrams

### 1. PCM5122 DAC (I2S Audio Output)

```
ESP32                     PCM5122 Module
─────                     ──────────────
GPIO 4  ────────────────► BCK    (Bit Clock)
GPIO 19 ────────────────► LRCK   (L/R Clock)
GPIO 23 ────────────────► DIN    (Data In)
GPIO 21 ◄──────────────── SDA    (I2C Data)   ┐ Shared I2C bus
GPIO 22 ────────────────► SCL    (I2C Clock)  ┘ with PN532
3.3V    ────────────────► VCC
GND     ────────────────► GND
                          ADDR1 → GND         (I2C address = 0x4C)
                          ADDR2 → GND

                          VOUTL ────► 3.5mm Jack (Left)
                          VOUTR ────► 3.5mm Jack (Right)
                          AGND  ────► 3.5mm Jack (Ground)
```

**I2C Address:** 0x4C (both ADR1 and ADR2 tied to GND)

**Audio Output:** Line-level stereo via 3.5mm AUX jack. Connect VOUTL/VOUTR through 470uF coupling capacitors to the jack tip/ring, AGND to sleeve.

**Decoupling:** Place 10uF + 100nF capacitors between VCC and GND, as close to the PCM5122 as possible.

---

### 2. WS2812B LED Strip (60 LEDs)

```
ESP32                Level Shifter         WS2812B Strip
─────                ─────────────         ──────────────
GPIO 5  ───────────► LV IN    HV OUT ────► DIN
3.3V    ───────────► LV REF
GND     ───────────► GND       GND  ────► GND
                               HV REF ──── 5V Power Supply
                                            5V ────► VCC (5V, 3.6A max @ 60 LEDs)
```

**Power Budget:** 60 LEDs x 60mA (max white) = 3.6A @ 5V. In practice, LED patterns rarely exceed 1.5A. Use a dedicated 5V 2A+ supply, not the ESP32's 5V pin.

**Level Shifter:** WS2812B specifies VIH = 0.7 x VDD = 3.5V. The ESP32 outputs 3.3V, which is marginal. A single-channel level shifter (SN74LVC1T45 or similar) is recommended for reliability. Short runs (<30cm) often work without one.

**Data Line:** Keep the wire from GPIO 5 to the first LED as short as possible. Add a 330-470 ohm resistor in series.

**Capacitor:** Place a 1000uF capacitor across the strip's VCC/GND at the power injection point.

---

### 3. XTSD SPI Flash SD Card (Adafruit #6039 — 4GB)

```
ESP32                     Adafruit XTSD #6039
─────                     ────────────────────
GPIO 14 ────────────────► SCK   (SPI Clock)
GPIO 13 ────────────────► MOSI  (Master Out)
GPIO 12 ◄──────────────── MISO  (Master In)
GPIO 15 ────────────────► CS    (Chip Select, has pull-up)
3.3V    ────────────────► VIN   (3V/5V — onboard 3.3V regulator)
GND     ────────────────► GND
```

**SPI Bus:** Uses **HSPI** (not VSPI) to avoid conflict with I2S DOUT on GPIO 23 (VSPI default MOSI).

**Why XTSD?** The XTSD is a 4GB SPI flash chip that **emulates the SD card protocol**. It works with Arduino's built-in `SD.h` library — zero firmware changes. Advantages over a traditional microSD: smaller footprint (21.5mm × 17.7mm), soldered on (no ejection risk), pre-formatted FAT, built-in hardware ECC, industrial temp range (−25°C to +85°C).

**Storage Format:** FAT (pre-formatted). The firmware creates these directories on first boot:
```
/tracks/      ← .dpa encrypted FLAC files
/capsules/    ← .dpa encrypted capsule content
/videos/      ← .dpa encrypted video files
```

---

### 4. PN532 NFC Module (I2C Mode)

```
ESP32                     PN532 Module
─────                     ────────────
GPIO 21 ◄──────────────── SDA          ┐ Shared I2C bus
GPIO 22 ────────────────► SCL          ┘ with PCM5122
3.3V    ────────────────► VCC
GND     ────────────────► GND

                          Mode DIP switches:
                          SEL0 = ON  (HIGH)
                          SEL1 = OFF (LOW)
                          → I2C mode selected
```

**I2C Pull-ups:** Both SDA and SCL need 4.7K pull-up resistors to 3.3V. Many breakout boards include these on-board. If using both PCM5122 and PN532 on the same bus, ensure only one set of pull-ups is active.

**NDEF Tag:** The firmware programs the PN532 to emulate an NDEF tag containing a URL record: `https://dpa.audio/d/{DUID}`. When a phone taps the device, it opens this URL in the browser, which triggers the portal to auto-connect via BLE.

---

### 5. Buttons (5x Tactile Switches)

```
ESP32                     Buttons (Active LOW)
─────                     ───────────────────

GPIO 25 ──────┤ ├──── GND     PLAY   ▶
GPIO 26 ──────┤ ├──── GND     PAUSE  ⏸
GPIO 27 ──────┤ ├──── GND     NEXT   ⏭
GPIO 32 ──────┤ ├──── GND     PREV   ⏮
GPIO 33 ──────┤ ├──── GND     MODE   ◉

Note: Internal pull-ups enabled (INPUT_PULLUP)
      No external resistors needed
```

**Debounce:** 35ms software debounce in firmware.

**Mode Button Functions:**
| Action | Behavior |
|--------|----------|
| Short press | Toggle WiFi portal ON/OFF |
| Long press (2s) | Enter BLE pairing mode (clear bonds, restart advertising) |

---

### 6. Battery Monitoring (LiPo ADC)

```
                    ┌─────────────┐
VBAT (3.0-4.2V) ───┤ R1 = 100K   ├───┬──► GPIO 34 (ADC input)
                    └─────────────┘   │
                                      │
                    ┌─────────────┐   │
              GND ──┤ R2 = 100K   ├───┘
                    └─────────────┘

                    100nF ceramic cap
              GND ──┤├──── GPIO 34     (noise filtering)
```

**Voltage Divider:** R1 = R2 = 100K ohm. Divides battery voltage by 2.

**Calculation:**
```
V_adc = V_batt x (R2 / (R1 + R2)) = V_batt x 0.5
V_batt = ADC_reading x (3.3 / 4095) x 2.0
```

**Percentage Mapping:** Linear interpolation from 3.0V (0%) to 4.2V (100%).

**Sampling:** 16-sample average, read every 2 seconds.

**Charging Detection:** If voltage > 4.18V and rising, firmware assumes charging.

---

## Complete Wiring Overview

```
                                    ┌──────────────────────────────┐
                                    │      5V Power Supply         │
                                    │       (2A minimum)           │
                                    └────────┬─────────────────────┘
                                             │
 ┌───────────────────────────────────────────────────────────────────────────┐
 │                                   │       │                              │
 │                        ┌──────────┴───────┴──────────┐                   │
 │                        │     WS2812B LED Strip        │                   │
 │                        │     (60 LEDs, 5V)            │                   │
 │                        │     DIN ◄── Level Shift      │                   │
 │                        └──────────────────────────────┘                   │
 │                                         ▲                                 │
 │  ┌──────────────────────────────────────┼────────────────────────────┐    │
 │  │          ESP32-WROVER-32             │ GPIO 5                    │    │
 │  │                                      │                           │    │
 │  │  GPIO 4  ──────────────────── I2S BCLK  ──────► PCM5122 BCK    │    │
 │  │  GPIO 19 ──────────────────── I2S LRCLK ──────► PCM5122 LRCK   │    │
 │  │  GPIO 23 ──────────────────── I2S DOUT  ──────► PCM5122 DIN    │    │
 │  │                                                                  │    │
 │  │  GPIO 21 ◄═══════════════════ I2C SDA ═══════► PCM5122 SDA     │    │
 │  │  GPIO 22 ════════════════════ I2C SCL ═══════► PCM5122 SCL     │    │
 │  │                                   ║                              │    │
 │  │                                   ╠═══════════► PN532 SDA       │    │
 │  │                                   ╚═══════════► PN532 SCL       │    │
 │  │                                                                  │    │
 │  │  GPIO 14 ──────────────────── HSPI SCK  ──────► XTSD SCK        │    │
 │  │  GPIO 13 ──────────────────── HSPI MOSI ──────► XTSD MOSI      │    │
 │  │  GPIO 12 ◄──────────────────── HSPI MISO ◄────── XTSD MISO     │    │
 │  │  GPIO 15 ──────────────────── HSPI CS   ──────► XTSD CS        │    │
 │  │                                                                  │    │
 │  │  GPIO 25 ──────┤ ├── GND     PLAY                               │    │
 │  │  GPIO 26 ──────┤ ├── GND     PAUSE                              │    │
 │  │  GPIO 27 ──────┤ ├── GND     NEXT                               │    │
 │  │  GPIO 32 ──────┤ ├── GND     PREV                               │    │
 │  │  GPIO 33 ──────┤ ├── GND     MODE                               │    │
 │  │                                                                  │    │
 │  │  GPIO 34 ◄──── Voltage Divider (100K/100K) ◄── VBAT             │    │
 │  │                                                                  │    │
 │  │  3.3V ─────────────────────────────────► VCC (all 3.3V modules) │    │
 │  │  GND ──────────────────────────────────► GND (all modules)      │    │
 │  └──────────────────────────────────────────────────────────────────┘    │
 └──────────────────────────────────────────────────────────────────────────┘

    PCM5122 Line Out                   Audio Path
    ────────────────                   ──────────
    VOUTL ──► 3.5mm Tip               XTSD Flash (.dpa files)
    VOUTR ──► 3.5mm Ring                    │
    AGND  ──► 3.5mm Sleeve            FLAC Decode (dr_flac)
                                            │
    Wireless Audio                     I2S → PCM5122 → Line Out (AUX)
    ──────────────                          │
    ESP32 A2DP Source ──► BT Speaker   BT A2DP Source → Wireless Speaker/Headphones
```

---

## Bus Summary

| Bus | Speed | Devices | Notes |
|-----|-------|---------|-------|
| **I2S** | BCLK = 6.144 MHz (96kHz x 32bit x 2ch) | PCM5122 | Unidirectional (TX only) |
| **I2C** | 100 kHz (standard) | PCM5122 (0x4C), PN532 (0x24) | Shared bus, 4.7K pull-ups |
| **HSPI** | 20 MHz | XTSD Flash (Adafruit #6039) | Dedicated bus (avoids VSPI conflict) |
| **ADC1** | — | Battery divider (GPIO 34) | Cannot use ADC2 when WiFi active |

> **ADC Note:** GPIO 34 is on **ADC1**. This is important because ADC2 channels (GPIO 0, 2, 4, 12-15, 25-27) cannot be used while WiFi is active. Since this device uses WiFi for the portal, battery monitoring must be on ADC1 (GPIO 32-39).

---

## Arduino IDE Setup

### Board Configuration

| Setting | Value |
|---------|-------|
| Board | ESP32 Dev Module |
| Flash Size | 4MB |
| Partition Scheme | Default 4MB with spiffs |
| PSRAM | Enabled (WROVER) or Disabled (WROOM) |
| Bluetooth | **BT + BLE** (required for A2DP) |
| Core Debug Level | Info (or None for production) |
| Upload Speed | 921600 |

> **Critical:** The Bluetooth setting must be **"BT + BLE"** (not "BLE Only") to enable Classic Bluetooth for A2DP audio streaming. If set to "BLE Only", the `HAS_A2DP` define will not activate and Bluetooth speaker/headphone support will be disabled.

### Required Libraries

| Library | Version | Source |
|---------|---------|--------|
| FastLED | 3.6+ | Arduino Library Manager |
| Adafruit PN532 | 1.3+ | Arduino Library Manager (only if `HAS_NFC` enabled) |
| dr_flac.h | latest | [github.com/mackron/dr_libs](https://github.com/mackron/dr_libs) (only if `HAS_DAC` enabled) |

**dr_flac:** Download `dr_flac.h` from the dr_libs repository and place it in the `firmware/` directory alongside `dpa-fan-sim.ino`.

### Build Flags

The firmware uses compile-time flags to enable hardware features. Uncomment these at the top of the `.ino` file:

```cpp
// #define HAS_DAC    // Uncomment when PCM5122 + SD card are wired
// #define HAS_NFC    // Uncomment when PN532 NFC module is wired
// HAS_A2DP is auto-detected from Arduino board config (BT + BLE)
```

**Minimal Build (simulation mode):** Leave both commented out. The firmware runs all portal/BLE/ESP-NOW/LED features without real audio or NFC hardware.

**Full Build:** Uncomment both `HAS_DAC` and `HAS_NFC`, ensure `dr_flac.h` is in the firmware folder.

---

## Power Architecture

```
USB-C (5V)
    │
    ├──► LiPo Charger (TP4056 or similar)
    │         │
    │         └──► LiPo Battery (3.7V, 2000mAh+)
    │                   │
    │                   ├──► Voltage Divider → GPIO 34 (ADC)
    │                   │
    │                   └──► 3.3V LDO (AMS1117-3.3 on DevKit)
    │                             │
    │                             ├──► ESP32 (3.3V)
    │                             ├──► PCM5122 (3.3V)
    │                             ├──► PN532 (3.3V)
    │                             └──► XTSD Flash (3.3V)
    │
    └──► 5V Rail
              │
              └──► WS2812B LED Strip (5V)
```

**Current Budget (estimated):**

| Component | Active | Sleep |
|-----------|--------|-------|
| ESP32 (WiFi + BLE + BT) | ~240mA | ~10mA |
| PCM5122 DAC | ~30mA | ~1mA |
| WS2812B (60 LEDs, avg pattern) | ~500mA | 0mA |
| XTSD Flash (read) | ~80mA | ~0.1mA |
| PN532 | ~120mA | ~1mA |
| **Total** | **~970mA** | **~12mA** |

**Battery Life Estimate:** 2000mAh / 970mA = ~2 hours continuous playback with LEDs. With LEDs dimmed to 50%, expect ~3 hours.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No audio output | I2S pins wrong | Verify GPIO 4/19/23 connections to PCM5122 |
| Garbled/noisy audio | I2C config failed | Check 0x4C address (ADR1/ADR2 to GND), verify pull-ups |
| LEDs don't light | Data pin or power | Check GPIO 5 → DIN, verify 5V supply to strip |
| LEDs flicker randomly | Signal integrity | Add 330 ohm resistor on data line, use level shifter |
| XTSD not detected | SPI wiring | Verify HSPI pins (12/13/14/15), check CS pull-up present on breakout |
| XTSD intermittent | Power brownout | Add 100uF cap on XTSD VIN, check LDO capacity |
| Battery shows -1% | ADC not connected | Check voltage divider on GPIO 34, verify R1/R2 values |
| BLE won't connect | Pairing stale | Long-press MODE button (2s) to clear bonds |
| A2DP not available | Board config wrong | Set Bluetooth to "BT + BLE" in Arduino IDE |
| NFC not detected | Wrong I2C mode | Set PN532 DIP switches: SEL0=ON, SEL1=OFF |
| WROVER crashes on boot | GPIO 16/17 conflict | Do NOT connect anything to GPIO 16 or 17 |
| WiFi portal unreachable | Wrong network | Join the device's WiFi AP (SSID = DUID, pass = dpa12345) |
