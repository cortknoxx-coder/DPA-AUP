/*
 * MISO line test — is the ESP32 actually receiving data?
 */
#include <SPI.h>

#define SD_CS    10
#define SD_MOSI  11
#define SD_SCK   12
#define SD_MISO  13

SPIClass sdSPI(FSPI);

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== MISO LINE TEST ===");

  // Test 1: Read MISO pin as raw GPIO (no SPI)
  pinMode(SD_MISO, INPUT_PULLUP);
  delay(10);
  int val = digitalRead(SD_MISO);
  Serial.printf("MISO (GP13) raw read with pullup: %d (expect 1)\n", val);

  pinMode(SD_MISO, INPUT_PULLDOWN);
  delay(10);
  val = digitalRead(SD_MISO);
  Serial.printf("MISO (GP13) raw read with pulldown: %d (expect 0)\n", val);

  pinMode(SD_MISO, INPUT);
  delay(10);
  val = digitalRead(SD_MISO);
  Serial.printf("MISO (GP13) raw read floating: %d\n", val);

  // Test 2: SPI loopback - send bytes and read back
  // With no device responding, MISO should be 0xFF (pulled high)
  // If it's always 0x00, MISO is shorted to ground
  Serial.println("\nSPI bus test (CS HIGH, no device selected):");
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);  // deselect device
  delay(100);

  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, -1);
  sdSPI.setFrequency(250000);

  Serial.print("Reading 16 bytes with CS HIGH: ");
  bool allZero = true;
  bool allFF = true;
  for (int i = 0; i < 16; i++) {
    uint8_t r = sdSPI.transfer(0xFF);
    Serial.printf("%02X ", r);
    if (r != 0x00) allZero = false;
    if (r != 0xFF) allFF = false;
  }
  Serial.println();

  if (allFF) {
    Serial.println("Result: ALL 0xFF — MISO line is HIGH (normal, no device talking)");
  } else if (allZero) {
    Serial.println("Result: ALL 0x00 — MISO is stuck LOW (shorted to GND!)");
  } else {
    Serial.println("Result: Mixed values — something is driving MISO");
  }

  // Test 3: Same but with CS LOW (device selected)
  Serial.print("\nReading 16 bytes with CS LOW:  ");
  digitalWrite(SD_CS, LOW);
  delay(10);
  allZero = true;
  allFF = true;
  for (int i = 0; i < 16; i++) {
    uint8_t r = sdSPI.transfer(0xFF);
    Serial.printf("%02X ", r);
    if (r != 0x00) allZero = false;
    if (r != 0xFF) allFF = false;
  }
  digitalWrite(SD_CS, HIGH);
  Serial.println();

  if (allFF) {
    Serial.println("Result: ALL 0xFF — device not responding on MISO");
  } else if (allZero) {
    Serial.println("Result: ALL 0x00 — MISO stuck LOW even when device selected");
    Serial.println("\n*** MISO is likely shorted to GND or bad solder ***");
    Serial.println("Check the solder joint on GP13 AND on the SD module MISO pin");
  } else {
    Serial.println("Result: Mixed — device IS talking! MISO works.");
  }

  Serial.println("\n=== TEST COMPLETE ===");
}

void loop() {
  delay(10000);
}
