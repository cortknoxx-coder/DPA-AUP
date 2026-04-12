#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, List, Optional


PERSISTENT_PATTERN_CASES = [
    {"pattern": "breathing", "color": "#ff4bcb", "gradEnd": "#ff99dd"},
    {"pattern": "solid", "color": "#00f1df", "gradEnd": "#00f1df"},
    {"pattern": "pulse", "color": "#ff7a00", "gradEnd": "#ffcf33"},
    {"pattern": "off", "color": "#000000", "gradEnd": "#000000"},
    {"pattern": "rainbow", "color": "#00aaff", "gradEnd": "#ff00aa", "fullSpectrum": True},
    {"pattern": "comet", "color": "#00ff88", "gradEnd": "#ff0044"},
    {"pattern": "wave", "color": "#3366ff", "gradEnd": "#00ccff"},
    {"pattern": "sparkle", "color": "#ff55cc", "gradEnd": "#ffeedd"},
    {"pattern": "fire", "color": "#ff3300", "gradEnd": "#ffcc00"},
    {"pattern": "dual_comet", "color": "#22ddff", "gradEnd": "#ff33aa"},
    {"pattern": "meteor", "color": "#ff6600", "gradEnd": "#fff2b3"},
    {"pattern": "theater", "color": "#00ffcc", "gradEnd": "#0066ff"},
    {"pattern": "bounce", "color": "#aa66ff", "gradEnd": "#ff44aa"},
    {"pattern": "audio_pulse", "color": "#44ffaa", "gradEnd": "#00ffaa"},
    {"pattern": "audio_bass", "color": "#ff2266", "gradEnd": "#6600ff"},
    {"pattern": "audio_beat", "color": "#ffffff", "gradEnd": "#88ccff"},
    {"pattern": "audio_comet", "color": "#00ffff", "gradEnd": "#ff00ff"},
    {"pattern": "audio_vu", "color": "#00ff88", "gradEnd": "#ff0044"},
    {"pattern": "vu_classic", "color": "#00ff88", "gradEnd": "#ff0044"},
    {"pattern": "vu_fill", "color": "#0088ff", "gradEnd": "#ff6600"},
    {"pattern": "vu_peak", "color": "#00ffaa", "gradEnd": "#ff0066"},
    {"pattern": "vu_split", "color": "#00ccff", "gradEnd": "#6633ff"},
    {"pattern": "vu_bass", "color": "#ff0066", "gradEnd": "#6600ff"},
    {"pattern": "vu_energy", "color": "#ffaa00", "gradEnd": "#ff0044"},
]

MODES = ("idle", "playback", "charging")


def http_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode())


def get_status(base_url: str) -> dict[str, Any]:
    return http_json(f"{base_url}/api/status")


def preview(base_url: str, mode: str, case: dict[str, Any], brightness: int) -> dict[str, Any]:
    query = {
        "mode": mode,
        "pattern": case["pattern"],
        "color": case["color"],
        "gradEnd": case["gradEnd"],
        "brightness": str(brightness),
        "fullSpectrum": "1" if case.get("fullSpectrum") else "0",
    }
    url = f"{base_url}/api/led/preview?{urllib.parse.urlencode(query)}"
    return http_json(url)


def verify_state(status: dict[str, Any], mode: str, case: dict[str, Any], brightness: int) -> Optional[str]:
    led = status.get("led") or {}
    mode_state = (led.get(mode) or {})
    actual_pattern = mode_state.get("pattern")
    actual_color = mode_state.get("color")
    actual_full_spectrum = mode_state.get("fullSpectrum", False)
    actual_grad_end = led.get("gradEnd")
    actual_brightness = led.get("brightness")

    if actual_pattern != case["pattern"]:
        return f"{mode}:{case['pattern']} pattern mismatch ({actual_pattern})"
    if actual_color != case["color"]:
        return f"{mode}:{case['pattern']} color mismatch ({actual_color})"
    if actual_grad_end != case["gradEnd"]:
        return f"{mode}:{case['pattern']} gradEnd mismatch ({actual_grad_end})"
    if bool(actual_full_spectrum) != bool(case.get("fullSpectrum", False)):
        return f"{mode}:{case['pattern']} fullSpectrum mismatch ({actual_full_spectrum})"
    if actual_brightness != brightness:
        return f"{mode}:{case['pattern']} brightness mismatch ({actual_brightness})"
    return None


def restore_state(base_url: str, status: dict[str, Any]) -> None:
    led = status.get("led") or {}
    brightness = int(led.get("brightness", 80))
    grad_end = led.get("gradEnd", "#ff6600")
    for mode in MODES:
        mode_state = (led.get(mode) or {})
        query = {
            "mode": mode,
            "pattern": mode_state.get("pattern", "breathing"),
            "color": mode_state.get("color", "#ffffff"),
            "gradEnd": grad_end,
            "brightness": str(brightness),
            "fullSpectrum": "1" if mode_state.get("fullSpectrum") else "0",
        }
        url = f"{base_url}/api/led/preview?{urllib.parse.urlencode(query)}"
        http_json(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Cycle all persistent LED effects on a DPA device and verify round-trip state.")
    parser.add_argument("--base-url", default="http://192.168.4.1")
    parser.add_argument("--brightness", type=int, default=72)
    parser.add_argument("--dwell", type=float, default=0.35, help="Seconds to leave each pattern active.")
    parser.add_argument("--rounds", type=int, default=1, help="How many complete passes to run.")
    args = parser.parse_args()

    original_status = get_status(args.base_url)
    failures: List[str] = []
    total_cases = len(PERSISTENT_PATTERN_CASES) * len(MODES) * args.rounds
    step = 0

    try:
        for round_idx in range(args.rounds):
            print(f"Round {round_idx + 1}/{args.rounds}")
            for mode in MODES:
                for case in PERSISTENT_PATTERN_CASES:
                    step += 1
                    label = f"{step}/{total_cases} {mode}:{case['pattern']}"
                    print(label)
                    result = preview(args.base_url, mode, case, args.brightness)
                    if result.get("ok") is not True:
                        failures.append(f"{label} preview returned {result}")
                        continue
                    status = get_status(args.base_url)
                    mismatch = verify_state(status, mode, case, args.brightness)
                    if mismatch:
                        failures.append(mismatch)
                    time.sleep(args.dwell)
    finally:
        try:
            restore_state(args.base_url, original_status)
            print("Restored original LED state.")
        except Exception as exc:  # pragma: no cover - best effort cleanup
            failures.append(f"restore failed: {exc}")

    if failures:
        print("\nFailures:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("\nLED soak completed without API/state mismatches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
