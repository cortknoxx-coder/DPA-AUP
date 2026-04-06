# DPA Quick Reference — Pull, Build, Flash, Run

Use this every time you start a dev session on your Mac.

## 1. Pull Latest

```bash
cd /Users/corts/Documents/GitHub/DPA-AUP
git pull origin cursor/development-environment-setup-f5d1
```

## 2. Build & Flash Firmware

```bash
export PATH="$PATH:/Users/corts/Library/Python/3.9/bin"
cd /Users/corts/Documents/GitHub/DPA-AUP/firmware/dpa-esp32
pio run
ls /dev/cu.usbmodem*
pio run --target upload --upload-port /dev/cu.usbmodem101
pio device monitor -p /dev/cu.usbmodem101 -b 115200
```

> Replace `usbmodem101` with whatever `ls /dev/cu.usbmodem*` prints.  
> If flash fails: **hold BOOT → tap RST → release BOOT**, then re-run upload.  
> `Ctrl+C` to exit serial monitor.

## 3. Run Creator / Fan Portal

Open a **new terminal tab** (`Cmd+T`):

```bash
cd /Users/corts/Documents/GitHub/DPA-AUP
npm install --legacy-peer-deps
npx ng serve
```

Open **http://localhost:4200** in Chrome.

## One-Time Setup

Make `pio` permanent (only need to do this once, ever):

```bash
echo 'export PATH="$PATH:/Users/corts/Library/Python/3.9/bin"' >> ~/.zshrc
source ~/.zshrc
```

After that you never need the `export PATH` line again.
