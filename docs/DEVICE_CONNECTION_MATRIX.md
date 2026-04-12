# Device Connection Matrix

This project is device-authenticated first. The production mental model is:

1. Authenticate first
2. Connect to the DPA
3. Pull from the DPA
4. Reveal the portal from that authenticated device context

The device connection path is mission-critical, not optional.

## On DPA SSID

- Network: the phone or desktop is joined to the branded DPA access point.
- Reachability: direct device path, typically `192.168.4.1`.
- Fan portal: reveal only after confirmed connect, then pull fan state from the device.
- Creator portal: reveal only after confirmed connect, then allow push, transfer, and verification flows.
- Controlling surface: portal + device together, with the live session hydrated from the DPA.

## On Same Home WiFi

- Network: the phone or desktop and the DPA are on the same LAN, with the DPA in station mode.
- Reachability: local LAN device path, subject to browser/platform constraints.
- Fan portal: reveal only after confirmed live device detection, then hydrate from the device.
- Creator portal: reveal only after confirmed live device detection, then run creator operations against the device.
- Browser stance: Chrome is recommended for shared-LAN workflows.
- Controlling surface: portal remains the UI, but the live state must still come from the DPA.

## Remote Only

- Network: the user is not on the DPA SSID and does not have a confirmed live DPA path.
- Reachability: no guaranteed device session.
- Fan portal: authenticated account context may exist, but the full device-authenticated dashboard stays hidden.
- Creator portal: transfer, push, verification, and device dashboards stay hidden.
- Controlling surface: none for live device UX until a real DPA session is restored.

## Product Rules

- `DUID` is the true unique device identity.
- The fan and creator dashboards must stay gated until a confirmed device transport exists.
- The portal should never pretend the DPA is live when it is not reachable.
- The device UI remains a first-class experience, but the portal controls the authenticated session once the DPA is confirmed.
