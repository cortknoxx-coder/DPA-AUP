# DPA Device — Perfboard Soldering Guide

**DPA** (Digital Playback Asset) — brought to you by **The DPAC** (Digital Playback Asset Consortium)

> **⚠ Legacy document — WROVER-era hardware.** This guide was written for the v1.0.0 ESP32-WROVER-32 prototype. The current production hardware is the **Waveshare ESP32-S3 Zero** with a different pin map and much smaller footprint. **Do not solder from the pin numbers below.** See [`HARDWARE-WIRING.md`](HARDWARE-WIRING.md) for the authoritative S3 Zero pinout. This file is kept for historical reference only and will be replaced with an S3 Zero perfboard guide.

**Legacy firmware:** v1.0.0 | **Legacy board:** 7×9cm double-sided perfboard | **Legacy MCU:** ESP32-WROVER-32 DevKit V1 (30-pin)

---

## Required Board

**7×9cm double-sided prototype perfboard** (2.54mm pitch, plated through-holes)

- **Columns:** A through Z (26 usable positions, 7cm)
- **Rows:** 1 through 34 (34 usable positions, 9cm)
- Grid reference format: **Column + Row** (e.g., `G3`, `T8`, `P15`)
- Orientation: **Portrait** (7cm wide, 9cm tall)
- Row 1 = TOP edge, Row 34 = BOTTOM edge
- Column A = LEFT edge, Column Z = RIGHT edge

> **Important:** The small 5×3.5cm board in your photo is too small. Get a **7×9cm** board — search "7x9cm prototype PCB double sided" on Amazon/AliExpress.

---

## Bill of Materials (Solder BOM)

| # | Component | Qty | Spec | Placement | Notes |
|---|-----------|-----|------|-----------|-------|
| 1 | Female pin header (1×15) | 2 | 2.54mm pitch, 15-pin straight | G3–G17, P3–P17 | ESP32 DevKit sockets |
| 2 | Female pin header (1×7) | 1 | 2.54mm pitch, 7-pin straight | T5–T11 | PCM5122 DAC socket |
| 3 | Female pin header (1×6) | 1 | 2.54mm pitch, 6-pin straight | B20–B25 | XTSD flash card socket |
| 4 | Tactile switch 6×6mm | 5 | 4-pin through-hole, momentary | See Button Map | PLAY, PAUSE, NEXT, PREV, MODE |
| 5 | 100K ohm resistor | 2 | 1/4W, axial through-hole | D7–D9, D9–D10 | Battery voltage divider |
| 6 | 100nF ceramic capacitor | 2 | MLCC or disc, 2.54mm lead pitch | D10–E10, T12–U12 | ADC filter + DAC decoupling |
| 7 | 10uF electrolytic capacitor | 1 | 16V, radial, 2mm lead spacing | U13–U14 | DAC power decoupling |
| 8 | 330 ohm resistor | 1 | 1/4W, axial through-hole | V17–V19 | LED data line protection |
| 9 | SN74LVC1T45 breakout or single FET level shifter | 1 | SOT-23-5 breakout or 3-pin module | V15–V19 area | 3.3V→5V for WS2812B (optional) |
| 10 | 2-pin screw terminal | 3 | 5mm pitch, PCB mount | See Connector Map | Battery, LED strip power, LED strip data |
| 11 | 3.5mm stereo audio jack | 1 | PJ-307 or similar, 5-pin PCB mount | S28–V30 | Line-level audio output |
| 12 | 4-pin JST-XH header | 1 | 2.54mm pitch, right-angle or straight | U31–X31 | PN532 NFC off-board cable |
| 13 | 30 AWG wire-wrap wire | 1 roll | Multiple colors (see wire table) | — | Point-to-point wiring on solder side |
| 14 | ESP32-WROVER-32 DevKit V1 | 1 | 30-pin (15 per side) | Plugs into G3–G17 / P3–P17 | NOT soldered — sits in female headers |
| 15 | PCM5122 DAC breakout module | 1 | Generic 7-10 pin, I2S+I2C | Plugs into T5–T11 | NOT soldered — sits in female header |
| 16 | Adafruit XTSD SPI Flash SD Card #6039 (4GB) | 1 | 6-pin | Plugs into B20–B25 | NOT soldered — sits in female header |
| 17 | PN532 NFC module | 1 | I2C mode, 4-wire cable | OFF-BOARD via JST cable | Mounted separately in enclosure |
| 18 | 4.7K ohm resistor | 2 | 1/4W, axial | R6–R3, S9–S3 | I2C pull-ups (SDA + SCL) to 3.3V |
| 19 | 1000uF electrolytic capacitor | 1 | 10V+, radial | OFF-BOARD at LED strip | Placed at LED strip power input |

---

## ESP32 DevKit V1 (30-Pin) Pinout Reference

This is the pin order when the DevKit is plugged in with USB port facing Row 1 (top edge).

### Left Header — Column G (Rows 3–17)

| Grid | Row | ESP32 Pin | GPIO | Function in DPA |
|------|-----|-----------|------|-----------------|
| G3 | 3 | 3V3 | — | 3.3V power rail |
| G4 | 4 | EN | — | Enable (leave unconnected) |
| G5 | 5 | VP | GPIO 36 | — (unused, input only) |
| G6 | 6 | VN | GPIO 39 | — (unused, input only) |
| **G7** | 7 | **D34** | **GPIO 34** | **Battery ADC input** |
| G8 | 8 | D35 | GPIO 35 | — (unused, input only) |
| **G9** | 9 | **D32** | **GPIO 32** | **Button: PREV** |
| **G10** | 10 | **D33** | **GPIO 33** | **Button: MODE** |
| **G11** | 11 | **D25** | **GPIO 25** | **Button: PLAY** |
| **G12** | 12 | **D26** | **GPIO 26** | **Button: PAUSE** |
| **G13** | 13 | **D27** | **GPIO 27** | **Button: NEXT** |
| **G14** | 14 | **D14** | **GPIO 14** | **XTSD SCK (HSPI)** |
| **G15** | 15 | **D12** | **GPIO 12** | **XTSD MISO (HSPI)** |
| G16 | 16 | GND | — | Ground rail |
| **G17** | 17 | **D13** | **GPIO 13** | **XTSD MOSI (HSPI)** |

### Right Header — Column P (Rows 3–17)

| Grid | Row | ESP32 Pin | GPIO | Function in DPA |
|------|-----|-----------|------|-----------------|
| P3 | 3 | VIN | — | 5V input (from USB or battery) |
| P4 | 4 | GND | — | Ground rail |
| **P5** | 5 | **D23** | **GPIO 23** | **I2S DOUT → PCM5122 DIN** |
| **P6** | 6 | **D22** | **GPIO 22** | **I2C SCL → PCM5122 + PN532** |
| P7 | 7 | TX | GPIO 1 | Serial TX (leave for debug) |
| P8 | 8 | RX | GPIO 3 | Serial RX (leave for debug) |
| **P9** | 9 | **D21** | **GPIO 21** | **I2C SDA → PCM5122 + PN532** |
| **P10** | 10 | **D19** | **GPIO 19** | **I2S LRCLK → PCM5122 LCK** |
| P11 | 11 | D18 | GPIO 18 | — (unused, reserve) |
| **P12** | 12 | **D5** | **GPIO 5** | **LED Strip Data (WS2812B)** |
| P13 | 13 | D17 | GPIO 17 | **DO NOT USE** (WROVER PSRAM) |
| P14 | 14 | D16 | GPIO 16 | **DO NOT USE** (WROVER PSRAM) |
| **P15** | 15 | **D4** | **GPIO 4** | **I2S BCLK → PCM5122 BCK** |
| P16 | 16 | D2 | GPIO 2 | Onboard LED (optional) |
| **P17** | 17 | **D15** | **GPIO 15** | **XTSD CS (HSPI)** |

---

## Board Layout Map

```
COMPONENT SIDE (TOP VIEW) — 7×9cm Perfboard
USB port faces up (Row 1)

     A  B  C  D  E  F  G  H  I  J  K  L  M  N  O  P  Q  R  S  T  U  V  W  X  Y  Z
     │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │
 1 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○── TOP EDGE
 2 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
 3 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G3=3V3        P3=VIN
 4 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G4=EN         P4=GND
 5 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──█──○──○──○──○──○──○──  G5=VP         P5=GPIO23    T5=PCM VCC
 6 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──●──○──█──○──○──○──○──○──○──  G6=VN         P6=GPIO22    T6=PCM GND  R6=I2C pullup
 7 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──█──○──○──○──○──○──○──  G7=GPIO34     P7=TX        T7=PCM BCK
 8 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──█──○──○──○──○──○──○──  G8=GPIO35     P8=RX        T8=PCM DIN
 9 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──●──○──█──○──○──○──○──○──○──  G9=GPIO32     P9=GPIO21    T9=PCM LCK  R9=I2C pullup
10 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──█──○──○──○──○──○──○──  G10=GPIO33    P10=GPIO19   T10=PCM SCL
11 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──█──○──○──○──○──○──○──  G11=GPIO25    P11=GPIO18   T11=PCM SDA
12 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G12=GPIO26    P12=GPIO5
13 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G13=GPIO27    P13=GPIO17 ⛔
14 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G14=GPIO14    P14=GPIO16 ⛔
15 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G15=GPIO12    P15=GPIO4
16 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G16=GND       P16=GPIO2
17 ──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──■──○──○──○──○──○──○──○──○──○──○──  G17=GPIO13    P17=GPIO15
     │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │
     │  │  │  │  │  │  └──── ESP32 DevKit ────────┘  │  │  │  │  │  │  │  │  │  │
18 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
     │  │  │  │  │  │                                                  │  │  │  │
19 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
     │  │                                                              │  │  │  │
20 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B20=XTSD VIN
21 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B21=XTSD GND
22 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B22=XTSD SCK
23 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B23=XTSD MISO
24 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B24=XTSD MOSI
25 ──○──█──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──  B25=XTSD CS
     │  │                                                              │  │  │  │
26 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
     │     │     │     │     │     │     │     │     │     │     │     │     │
27 ──○──○──○──○──○──○──○──○──BTN──BTN──BTN──BTN──BTN──○──○──○──○──○──○──○──○──○──○──
28 ──○──○──○──○──○──○──○──○──PLAY─PAUSE NEXT─PREV─MODE──○──○──○──○──○──○──○──○──○──
29 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
     │                                                              │  │  │  │  │
30 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──■──■──■──■──○──○──○──  T30–W30: Audio Jack
31 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──■──■──■──■──○──○──  U31–X31: NFC JST header
32 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──
33 ──[BATT+ ][BATT- ]──○──○──[LED 5V ][LED GND][LED DIN]──○──○──○──○──○──○──○──○──  Screw terminals
34 ──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○──○── BOTTOM EDGE

LEGEND:
  ■ = Female header pin (solder socket from bottom, module plugs in from top)
  ● = I2C pull-up resistor pad
  ⛔ = Do NOT use (WROVER PSRAM conflict)
  ○ = Open hole (available for wiring)
```

---

## Component Placement — Pin by Pin

### 1. ESP32 DevKit V1 Female Header Sockets

Solder **two 1×15 female pin headers** from the bottom side of the board. The ESP32 DevKit will plug in from the top.

| Header | Column | Start Row | End Row | Notes |
|--------|--------|-----------|---------|-------|
| Left socket | **G** | **3** | **17** | 15 pins, solder from bottom |
| Right socket | **P** | **3** | **17** | 15 pins, solder from bottom |

**Verification:** The distance from column G to column P = 9 holes = 22.86mm. This matches the ESP32 DevKit V1 (30-pin) row spacing. If your DevKit has 10-hole spacing (25.4mm), use columns **G** and **Q** instead.

### 2. PCM5122 DAC Module Female Header Socket

Solder **one 1×7 female pin header** in Column T. Your PCM5122 breakout module plugs in from the top.

| Pin # | Grid | Module Pin | Description |
|-------|------|------------|-------------|
| 1 | **T5** | VCC | 3.3V power |
| 2 | **T6** | GND | Ground |
| 3 | **T7** | BCK | Bit clock (I2S BCLK) |
| 4 | **T8** | DIN | Data in (I2S audio data) |
| 5 | **T9** | LCK | Left/right clock (I2S LRCLK) |
| 6 | **T10** | SCL | I2C clock |
| 7 | **T11** | SDA | I2C data |

> **Note:** PCM5122 breakout pin orders vary by manufacturer. Check YOUR module's silkscreen and match the pin NAMES (VCC, GND, BCK, DIN, LCK, SCL, SDA) to the correct socket positions. Re-order if needed.

If your module has extra pins (FMT, XSMT, DEMP, FLT), extend the header to T12, T13, etc., and:
- **FMT** → tie to GND (I2S mode)
- **XSMT** → tie to 3.3V (unmuted)
- **DEMP** / **FLT** → leave unconnected

### 3. XTSD SPI Flash SD Card (Adafruit #6039) Female Header Socket

Solder **one 1×6 female pin header** in Column B. The XTSD is a 4GB soldered flash chip that emulates an SD card — same SPI pins, same `SD.h` library, no firmware changes.

| Pin # | Grid | Module Pin | Description |
|-------|------|------------|-------------|
| 1 | **B20** | VIN | 3.3V power (onboard regulator accepts 3V–5V) |
| 2 | **B21** | GND | Ground |
| 3 | **B22** | SCK | SPI clock |
| 4 | **B23** | MISO | Master In / Slave Out (data out from flash) |
| 5 | **B24** | MOSI | Master Out / Slave In (data in to flash) |
| 6 | **B25** | CS | Chip select (has onboard pull-up) |

### 4. Tactile Buttons (5×)

Standard 6mm tactile buttons need their legs bent slightly to fit the 2.54mm grid. Each button uses **2 active pins** (the other 2 are internally shorted duplicates).

Mount all 5 buttons in a row across Row 27–28:

| Button | Function | Pin A (GPIO) Grid | Pin B (GND) Grid |
|--------|----------|-------------------|-------------------|
| BTN1 | **PLAY** | **H27** | **H29** |
| BTN2 | **PAUSE** | **J27** | **J29** |
| BTN3 | **NEXT** | **L27** | **L29** |
| BTN4 | **PREV** | **N27** | **N29** |
| BTN5 | **MODE** | **P27** | **P29** |

**Orientation:** Each button bridges 2 rows (27 and 29). Pin A (top, row 27) connects to its GPIO via wire. Pin B (bottom, row 29) connects to GND bus.

**GND bus for buttons:** Run a bare wire along **Row 29 from H29 to P29**, soldered to each button's bottom pin. Then connect one end to a GND point.

### 5. I2C Pull-Up Resistors (2× 4.7K ohm)

| Resistor | From | To | Description |
|----------|------|----|-------------|
| R_SCL | **R6** | **R3** | SCL pull-up: R6 is near GPIO 22 (SCL), R3 bridges to 3.3V rail at Row 3 |
| R_SDA | **S9** | **S3** | SDA pull-up: S9 is near GPIO 21 (SDA), S3 bridges to 3.3V rail at Row 3 |

Wire **R3** to **G3** (3.3V) and **S3** to **G3** (3.3V) to complete the pull-up path.

### 6. Battery Voltage Divider (2× 100K ohm)

```
            R1 (100K)         R2 (100K)
BATT+ ────[D7]────[D9]────[D10]──── GND
                    │
                    └── GPIO 34 (at G7, connected via wire from D9)
```

| Component | From Grid | To Grid | Description |
|-----------|-----------|---------|-------------|
| R1 (100K top) | **D7** | **D9** | Upper divider resistor |
| R2 (100K bottom) | **D9** | **D11** | Lower divider resistor |
| C_filter (100nF) | **E9** | **E11** | Noise filter cap, parallel with R2 |

- Wire **D7** → screw terminal BATT+ at **A33**
- Wire **D9** → **G7** (GPIO 34 ADC input) — short jumper wire
- Wire **D11** → GND bus

### 7. Decoupling Capacitors

| Capacitor | (+) Grid | (−) Grid | For | Description |
|-----------|----------|----------|-----|-------------|
| 100nF ceramic | **T12** | **U12** | PCM5122 | Place right below DAC header, bridge T12 to GND |
| 10uF electrolytic | **T13** (+) | **U13** (−) | PCM5122 | Bulk decoupling, long leg (+) in T13 |

Wire **U12** and **U13** to the nearest GND point (P4 via a wire).

### 8. LED Data Line Resistor (330 ohm)

| From Grid | To Grid | Description |
|-----------|---------|-------------|
| **V16** | **V18** | 330 ohm in series on LED data line |

Wire **P12** (GPIO 5) → **V16** (resistor input). Wire **V18** (resistor output) → LED DIN screw terminal at Row 33.

### 9. 3.5mm Audio Jack (PJ-307 or similar)

Mount at the **bottom-right area** of the board:

| Jack Pin | Grid | Connection |
|----------|------|------------|
| Tip (Left audio) | **T30** | Wire to PCM5122 VOUTL (off-board from module) |
| Ring (Right audio) | **U30** | Wire to PCM5122 VOUTR (off-board from module) |
| Sleeve (Ground) | **V30** | Wire to audio GND (PCM5122 AGND) |

> **Note:** The PCM5122 module's analog outputs (VOUTL, VOUTR, AGND) connect to the audio jack via short wires from the module pins. These are NOT routed through the female header — they come directly off the module's output pins.

### 10. NFC Off-Board Connector (4-pin JST-XH)

Solder a 4-pin JST-XH header at the bottom-right:

| Pin # | Grid | Signal | Cable Color |
|-------|------|--------|-------------|
| 1 | **U31** | 3.3V | Red |
| 2 | **V31** | GND | Black |
| 3 | **W31** | SDA | Blue |
| 4 | **X31** | SCL | Yellow |

The PN532 NFC module mounts **separately in the enclosure** and connects via a 4-wire cable to this header.

### 11. Screw Terminals (Bottom Edge, Row 33)

| Terminal | Grid | Signal | Wire Color |
|----------|------|--------|------------|
| BATT+ | **A33** | Battery positive (3.0–4.2V) | Red |
| BATT− | **B33** | Battery negative / GND | Black |
| LED 5V | **G33** | 5V power to LED strip | Red |
| LED GND | **H33** | LED strip ground | Black |
| LED DIN | **I33** | LED strip data in | Green |

---

## Master Wire Table

All wires run on the **SOLDER SIDE (bottom)** of the board. Use **30 AWG wire-wrap wire** in the color indicated.

### I2S Audio Bus (ESP32 → PCM5122 DAC)

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W1 | **P15** (GPIO 4) | I2S BCLK | **T7** (PCM BCK) | Orange | ~3cm |
| W2 | **P5** (GPIO 23) | I2S DOUT | **T8** (PCM DIN) | Yellow | ~3cm |
| W3 | **P10** (GPIO 19) | I2S LRCLK | **T9** (PCM LCK) | Green | ~3cm |

### I2C Bus (ESP32 → PCM5122 + NFC)

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W4 | **P6** (GPIO 22) | I2C SCL | **T10** (PCM SCL) | Blue | ~3cm |
| W5 | **P6** (GPIO 22) | I2C SCL | **X31** (NFC SCL) | Blue | ~8cm |
| W6 | **P9** (GPIO 21) | I2C SDA | **T11** (PCM SDA) | White | ~3cm |
| W7 | **P9** (GPIO 21) | I2C SDA | **W31** (NFC SDA) | White | ~7cm |

> **I2C Note:** W4 and W5 share the same source (P6). Solder both wires to pad P6. Same for W6 and W7 sharing P9.

### I2C Pull-Up Resistors

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W8 | **R6** (top of R_SCL) → resistor → **R3** | SCL pull-up | — | — | Resistor body |
| W9 | **R3** | 3.3V for SCL pull-up | **G3** (3V3) | Red | ~3cm |
| W10 | **S9** (top of R_SDA) → resistor → **S3** | SDA pull-up | — | — | Resistor body |
| W11 | **S3** | 3.3V for SDA pull-up | **G3** (3V3) | Red | ~3cm |
| W12 | **R6** | SCL tap | **P6** (GPIO 22) | Blue | ~1cm |
| W13 | **S9** | SDA tap | **P9** (GPIO 21) | White | ~1cm |

### HSPI SD Card Bus (ESP32 → XTSD Flash)

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W14 | **G14** (GPIO 14) | XTSD SCK | **B22** (XTSD SCK) | Purple | ~4cm |
| W15 | **G15** (GPIO 12) | XTSD MISO | **B23** (XTSD MISO) | Brown | ~4cm |
| W16 | **G17** (GPIO 13) | XTSD MOSI | **B24** (XTSD MOSI) | Gray | ~4cm |
| W17 | **P17** (GPIO 15) | XTSD CS | **B25** (XTSD CS) | Tan | ~6cm |

> **W17 Note:** This wire crosses the full width of the board (column P → column B). Route it along the bottom edge to keep it tidy.

### LED Strip Data (ESP32 → Level Shifter → LED)

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W18 | **P12** (GPIO 5) | LED data out | **V16** (330Ω resistor in) | Green | ~2cm |
| W19 | **V18** (330Ω resistor out) | LED data (protected) | **I33** (LED DIN terminal) | Green | ~5cm |

### Battery ADC

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W20 | **D9** (divider midpoint) | ADC voltage | **G7** (GPIO 34) | Orange | ~1cm |
| W21 | **D7** (divider top) | BATT+ | **A33** (BATT+ terminal) | Red | ~5cm |

### Button Wiring

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W22 | **H27** (BTN1 top) | PLAY | **G11** (GPIO 25) | Blue | ~5cm |
| W23 | **J27** (BTN2 top) | PAUSE | **G12** (GPIO 26) | Blue | ~5cm |
| W24 | **L27** (BTN3 top) | NEXT | **G13** (GPIO 27) | Blue | ~5cm |
| W25 | **N27** (BTN4 top) | PREV | **G9** (GPIO 32) | Blue | ~5cm |
| W26 | **P27** (BTN5 top) | MODE | **G10** (GPIO 33) | Blue | ~5cm |

### Power Distribution

| Wire # | From | Signal | To | Color | Length |
|--------|------|--------|-----|-------|--------|
| W27 | **G3** (3V3) | 3.3V power | **T5** (PCM VCC) | Red | ~4cm |
| W28 | **G3** (3V3) | 3.3V power | **B20** (XTSD VIN) | Red | ~5cm |
| W29 | **G3** (3V3) | 3.3V power | **U31** (NFC 3.3V) | Red | ~6cm |
| W30 | **G16** (GND) | Ground | **T6** (PCM GND) | Black | ~4cm |
| W31 | **G16** (GND) | Ground | **B21** (XTSD GND) | Black | ~5cm |
| W32 | **G16** (GND) | Ground | **V31** (NFC GND) | Black | ~6cm |
| W33 | **G16** (GND) | Ground | **B33** (BATT− terminal) | Black | ~5cm |
| W34 | **G16** (GND) | Ground | **H33** (LED GND terminal) | Black | ~5cm |
| W35 | **P4** (GND) | Ground | **U12** (DAC decoupling cap −) | Black | ~2cm |
| W36 | **P4** (GND) | Ground | **D11** (voltage divider bottom) | Black | ~4cm |
| W37 | **P4** (GND) | Ground | **Row 29 bus** (button GND) | Black | ~4cm |
| W38 | **P3** (VIN 5V) | 5V power | **G33** (LED 5V terminal) | Red | ~5cm |

### Button GND Bus

| Wire # | From | To | Color | Description |
|--------|------|----|-------|-------------|
| W39 | **H29** | **P29** | Black | Bare wire along Row 29, soldered at H29, J29, L29, N29, P29 |
| W40 | **H29** | **P4** (or G16) | Black | GND bus to ground rail |

---

## Total Wire Count Summary

| Category | Wires | Color Code |
|----------|-------|------------|
| I2S Audio (3 wires) | W1–W3 | Orange, Yellow, Green |
| I2C Bus (4 wires + 2 taps) | W4–W7, W12–W13 | Blue, White |
| I2C Pull-ups (4 wires + 2 resistors) | W8–W11 | Red (power wires) |
| HSPI XTSD Flash (4 wires) | W14–W17 | Purple, Brown, Gray, Tan |
| LED Strip (2 wires + resistor) | W18–W19 | Green |
| Battery ADC (2 wires + 2 resistors + cap) | W20–W21 | Orange, Red |
| Buttons (5 wires + bus) | W22–W26, W39–W40 | Blue, Black |
| Power rails (12 wires) | W27–W38 | Red (power), Black (ground) |
| **TOTAL** | **40 wires + 7 passive components** | |

---

## Soldering Order (Step by Step)

Follow this exact order. Each step must be completed before the next.

| Step | Action | Components | Verify |
|------|--------|------------|--------|
| 1 | Solder female headers for ESP32 | 2× 1×15 at G3–G17 and P3–P17 | Headers straight, pins accessible from top |
| 2 | Solder female header for PCM5122 | 1× 1×7 at T5–T11 | Header straight |
| 3 | Solder female header for XTSD flash | 1× 1×6 at B20–B25 | Header straight |
| 4 | Solder I2C pull-up resistors | 4.7K at R3–R6 and S3–S9 | Resistor values correct (yellow-violet-red) |
| 5 | Solder voltage divider resistors | 2× 100K at D7–D9 and D9–D11 | Resistor values correct (brown-black-yellow) |
| 6 | Solder filter cap (100nF) | C_filter at E9–E11 | No polarity (ceramic) |
| 7 | Solder DAC decoupling caps | 100nF at T12–U12, 10uF at T13–U13 | Electrolytic: long leg (+) in T13 |
| 8 | Solder 330Ω LED resistor | At V16–V18 | (orange-orange-brown) |
| 9 | Solder screw terminals | Row 33: A33/B33, G33/H33, I33 | Openings face board edge |
| 10 | Solder NFC JST header | U31–X31 (4-pin) | Opening faces board edge |
| 11 | Solder audio jack | T30–V30 area | Test fit first |
| 12 | Solder tactile buttons | H27, J27, L27, N27, P27 (5 buttons) | All buttons click when pressed |
| 13 | **FLIP BOARD — solder side up** | | |
| 14 | Solder button GND bus wire | W39: bare wire H29 → P29 | Solder at each button's GND pin |
| 15 | Solder I2S wires (W1–W3) | P15→T7, P5→T8, P10→T9 | Orange, Yellow, Green |
| 16 | Solder I2C wires (W4–W7, W12–W13) | P6→T10, P6→X31, P9→T11, P9→W31 | Blue, White |
| 17 | Solder I2C pull-up power wires | W9: R3→G3, W11: S3→G3 | Red |
| 18 | Solder HSPI SD wires (W14–W17) | G14→B22, G15→B23, G17→B24, P17→B25 | Purple, Brown, Gray, Tan |
| 19 | Solder LED data wire (W18–W19) | P12→V16, V18→I33 | Green |
| 20 | Solder battery ADC wire (W20–W21) | D9→G7, D7→A33 | Orange, Red |
| 21 | Solder button signal wires (W22–W26) | H27→G11, J27→G12, L27→G13, N27→G9, P27→G10 | All Blue |
| 22 | Solder power wires (W27–W29) | G3→T5, G3→B20, G3→U31 | All Red |
| 23 | Solder ground wires (W30–W37) | G16/P4 to T6, B21, V31, B33, H33, U12, D11, Row29 | All Black |
| 24 | Solder 5V LED power wire (W38) | P3→G33 | Red |
| 25 | **VISUAL INSPECTION** | | No solder bridges, no cold joints |
| 26 | Plug in ESP32 DevKit | Into G3–G17 / P3–P17 headers | USB port faces Row 1 (top) |
| 27 | Plug in PCM5122 module | Into T5–T11 header | Check pin order matches |
| 28 | Plug in XTSD flash card | Into B20–B25 header | Check pin order matches |

---

## Verification Checklist (Before Power On)

Use a multimeter in continuity mode. Test each connection from the table below.

| Test # | Probe A | Probe B | Expected | What It Checks |
|--------|---------|---------|----------|----------------|
| V1 | G3 (3V3) | T5 (PCM VCC) | Continuity | DAC power |
| V2 | G3 (3V3) | B20 (XTSD VIN) | Continuity | XTSD power |
| V3 | G3 (3V3) | U31 (NFC 3V3) | Continuity | NFC power |
| V4 | G16 (GND) | T6 (PCM GND) | Continuity | DAC ground |
| V5 | G16 (GND) | B21 (XTSD GND) | Continuity | XTSD ground |
| V6 | G16 (GND) | V31 (NFC GND) | Continuity | NFC ground |
| V7 | G16 (GND) | B33 (BATT−) | Continuity | Battery ground |
| V8 | G3 (3V3) | G16 (GND) | **NO continuity** | **No short on power rail** |
| V9 | P3 (VIN) | P4 (GND) | **NO continuity** | **No short on 5V rail** |
| V10 | P15 (GPIO 4) | T7 (PCM BCK) | Continuity | I2S BCLK wire |
| V11 | P5 (GPIO 23) | T8 (PCM DIN) | Continuity | I2S DOUT wire |
| V12 | P10 (GPIO 19) | T9 (PCM LCK) | Continuity | I2S LRCLK wire |
| V13 | P6 (GPIO 22) | T10 (PCM SCL) | Continuity | I2C SCL wire |
| V14 | P9 (GPIO 21) | T11 (PCM SDA) | Continuity | I2C SDA wire |
| V15 | G14 (GPIO 14) | B22 (XTSD SCK) | Continuity | HSPI CLK wire |
| V16 | G15 (GPIO 12) | B23 (XTSD MISO) | Continuity | HSPI MISO wire |
| V17 | G17 (GPIO 13) | B24 (XTSD MOSI) | Continuity | HSPI MOSI wire |
| V18 | P17 (GPIO 15) | B25 (XTSD CS) | Continuity | HSPI CS wire |
| V19 | Press each button | G11/G12/G13/G9/G10 to G16 | Continuity when pressed | Button wiring |
| V20 | G7 (GPIO 34) | D9 (divider mid) | Continuity | Battery ADC wire |

> **CRITICAL:** Tests V8 and V9 must show NO continuity. If either shows continuity, there is a short circuit. Find and fix before applying power.

---

## Off-Board Connections Reference

| Component | Cable | Connects To On Board | Notes |
|-----------|-------|---------------------|-------|
| WS2812B LED strip | 3-wire (5V, GND, DIN) | G33 (5V), H33 (GND), I33 (DIN) | Add 1000uF cap across 5V/GND at strip end |
| LiPo Battery | 2-wire (red +, black −) | A33 (BATT+), B33 (BATT−) | Through TP4056 charger module |
| PN532 NFC module | 4-wire JST cable | U31 (3V3), V31 (GND), W31 (SDA), X31 (SCL) | Set PN532 DIP: SEL0=ON, SEL1=OFF |
| 3.5mm AUX out | Wired from PCM5122 module | T30 (L), U30 (R), V30 (GND) | Via 470uF coupling caps recommended |
| USB-C | Built into ESP32 DevKit | Plugged into board headers | For programming + charging |
