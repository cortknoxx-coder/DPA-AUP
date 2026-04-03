#include <Arduino.h>
#include <WiFi.h>
#include "esp_chip_info.h"
#include "esp_flash.h"

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("=== ESP32-S3 Board Info ===");

  Serial.print("Chip model: ");
  Serial.println(ESP.getChipModel());

  Serial.print("Chip revision: ");
  Serial.println(ESP.getChipRevision());

  Serial.print("CPU frequency (MHz): ");
  Serial.println(ESP.getCpuFreqMHz());

  Serial.print("Number of cores: ");
  Serial.println(ESP.getChipCores());

  Serial.print("Flash chip size (bytes): ");
  Serial.println(ESP.getFlashChipSize());

  Serial.print("Flash speed (Hz): ");
  Serial.println(ESP.getFlashChipSpeed());

  Serial.print("PSRAM size (bytes): ");
  Serial.println(ESP.getPsramSize());

  Serial.print("Free PSRAM (bytes): ");
  Serial.println(ESP.getFreePsram());

  Serial.print("Free heap (bytes): ");
  Serial.println(ESP.getFreeHeap());

  Serial.print("Min free heap (bytes): ");
  Serial.println(ESP.getMinFreeHeap());

  Serial.print("Max alloc heap (bytes): ");
  Serial.println(ESP.getMaxAllocHeap());

  Serial.print("SDK version: ");
  Serial.println(ESP.getSdkVersion());

  Serial.print("Sketch size (bytes): ");
  Serial.println(ESP.getSketchSize());

  Serial.print("Free sketch space (bytes): ");
  Serial.println(ESP.getFreeSketchSpace());

  WiFi.mode(WIFI_MODE_STA);
  delay(100);

  Serial.print("MAC address: ");
  Serial.println(WiFi.macAddress());

  Serial.println("==========================");
}

void loop() {
}