# DPA Quick Reference — Pull, Build, Flash, Run

## Linux Setup (Ubuntu / Debian — one-time)

### 1. Install system dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-pip git usbutils
```

### 2. Install PlatformIO CLI

```bash
pip3 install --user platformio
# Add to PATH (add this line to ~/.bashrc or ~/.zshrc)
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
source ~/.bashrc
```

### 3. Install Node.js (22 LTS recommended)

```bash
# Using NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 4. Clone the repo

```bash
cd ~/Documents
git clone https://github.com/cortknoxx-coder/DPA-AUP.git
cd DPA-AUP
```

### 5. Set up USB access for ESP32-S3

```bash
# Create udev rules so you can flash without sudo
sudo tee /etc/udev/rules.d/99-esp32.rules > /dev/null << 'EOF'
# ESP32-S3 native USB CDC/JTAG
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1001", MODE="0666", GROUP="dialout", SYMLINK+="esp32s3"
# ESP32-S3 bootloader/download mode
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1002", MODE="0666", GROUP="dialout"
# CP2102/CP2104 USB-UART
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", MODE="0666", GROUP="dialout"
# CH340/CH341 USB-UART
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", MODE="0666", GROUP="dialout"
EOF

# Reload udev and add yourself to dialout group
sudo udevadm control --reload-rules
sudo udevadm trigger
sudo usermod -aG dialout $USER
```

> **Important:** Log out and back in (or reboot) after `usermod` for the group change to take effect.

### 6. Plug in the DPA (USB port 1) and verify

```bash
lsusb                           # Should show "Espressif" or "USB JTAG/serial"
ls /dev/ttyACM*                 # Should show /dev/ttyACM0 (or similar)
```

> The Waveshare ESP32-S3 Zero uses **native USB CDC** — it shows up as `/dev/ttyACM0`, not `/dev/ttyUSB0`.
> If nothing shows up: **hold BOOT → tap RST → release BOOT** to enter download mode, then check again.

---

## Daily Dev Session

### 1. Pull latest

```bash
cd ~/Documents/DPA-AUP
git pull
```

### 2. Build & flash firmware

```bash
cd firmware/dpa-esp32
pio run                                              # Build
ls /dev/ttyACM*                                      # Find the port
pio run --target upload --upload-port /dev/ttyACM0    # Flash
pio device monitor -p /dev/ttyACM0 -b 115200         # Serial monitor
```

> Replace `ttyACM0` with whatever `ls /dev/ttyACM*` shows.
> If flash fails: **hold BOOT → tap RST → release BOOT**, then re-run upload.
> `Ctrl+C` to exit serial monitor.

### 3. Run Creator / Fan Portal

Open a **new terminal tab**:

```bash
cd ~/Documents/DPA-AUP
npm install --legacy-peer-deps
npm run dev
```

Open **http://localhost:3000** in Chrome.

---

## macOS Setup (one-time)

### Install PlatformIO

```bash
pip3 install --user platformio
echo 'export PATH="$PATH:$HOME/Library/Python/3.9/bin"' >> ~/.zshrc
source ~/.zshrc
```

### USB port

```bash
ls /dev/cu.usbmodem*                                  # Find port
pio run --target upload --upload-port /dev/cu.usbmodem101
pio device monitor -p /dev/cu.usbmodem101 -b 115200
```

> Replace `usbmodem101` with whatever `ls /dev/cu.usbmodem*` prints.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pio: command not found` | Run `export PATH="$PATH:$HOME/.local/bin"` and add to `~/.bashrc` |
| No `/dev/ttyACM*` after plugging in | Hold BOOT → tap RST → release BOOT, then re-check |
| `Permission denied` on `/dev/ttyACM0` | Run `sudo usermod -aG dialout $USER` then log out/in |
| Flash fails with "no serial data" | Wrong port — run `ls /dev/ttyACM*` and use the correct one |
| `npm install` fails | Try `npm install --legacy-peer-deps` |
| Build too big for flash | Already fixed — custom partition at 31.5% usage |
