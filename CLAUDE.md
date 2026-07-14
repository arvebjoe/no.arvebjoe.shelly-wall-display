# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Homey app (SDK v3, TypeScript) that turns a Shelly Wall Display into a kiosk control panel. It runs an Express + WebSocket server on port **8123** (the Home Assistant port — the Shelly display expects an HA server and this app emulates the HA handshake so the display accepts it). User interactions on the display trigger Homey Flow cards; Flows send state back to the display over WebSocket.

## Commands

- `npm run build` — TypeScript compile (output goes to `.homeybuild/`)
- `npm run lint` — ESLint 9 flat config (`eslint.config.mjs`: js + typescript-eslint recommended)
- `homey app run` — run the app on a Homey for development (Homey CLI)
- `homey app validate --level verified` — validation; CI runs this on every push
- There are no tests.

## Homey compose — do not edit root app.json

The root `app.json` is **generated** from compose sources by the Homey CLI. Edit these instead:

- `.homeycompose/app.json` — app manifest (id, version, permissions, `api` section)
- `.homeycompose/flow/triggers/*.json` and `.homeycompose/flow/actions/*.json` — Flow cards
- `drivers/display/driver.compose.json` — driver manifest

`.homeybuild/` is build output — never edit or read it as source.

## Architecture

Data flow: Shelly display (browser) ⇄ WebSocket ⇄ `KioskServer` (Express, port 8123) ⇄ events/method calls ⇄ `app.ts` ⇄ Homey Flow cards.

- **`app.ts`** — Homey.App entry point. Creates the `LayoutStore` and `KioskServer` and exposes `getEditorUrl()` (Homey's LAN IP + `/editor`). Flow cards are wired in the driver, not here.
- **`server.ts`** — `KioskServer`, the bulk of the logic. A typed EventEmitter (`tiny-typed-emitter`) hosting:
  - HA identity endpoints (`/auth/providers`, `/auth/login_flow`) that fake the Home Assistant handshake.
  - A catch-all `GET /.*` that routes by **client IP**: unregistered devices get `public/pending.html`; registered devices get their custom rendered layout from the `LayoutStore`, or `public/index.html` as fallback.
  - The GUI editor (`/editor`, SPA in `public/editor.html`) and its API under `/api/editor/*` (list devices, screen presets, load/save layouts, live preview). Saving a layout sends a `reload` WebSocket message so the display refreshes immediately.
  - WebSocket handling: device registry keyed by IP, ping/health checks (removed after 3 failed pings), and the message protocol (`scene`/`light` in; `scene-complete`/`light-complete`/`reload` out). Messages from unregistered IPs are ignored.
- **`src/layout-types.ts`** — layout data model (a tree of container/button/slider/label nodes with flexbox weights), screen-size presets, default layout, and `validateLayout()` for untrusted editor input.
- **`src/renderer.ts`** — renders a `GuiLayout` to a single self-contained HTML document; used both for the file served to the display and the editor's live preview (preview mode disables the WebSocket runtime). Escapes/sanitizes all user-provided values (colors, image URLs, text).
- **`src/layout-store.ts`** — persists layout JSON + rendered HTML per device under `/userdata/layouts/` (**the only writable, persistent folder on a Homey Pro**). Writes via temp file + rename to avoid corrupting a served file.
- **`drivers/display/`** — pairing lists the server's pending (connected-but-unregistered) devices; adding/renaming/deleting a device registers/unregisters its IP with the `KioskServer`. Device identity **is the IP address** (`data.id`). All Flow cards are **device-level** (each card has a `device` arg with `filter: driver_id=display`) and are wired in `driver.ts`: server `scene`/`light` events carry the source IP and trigger `getDeviceTriggerCard(...)` on the matching device; action cards resolve `args.device` to its IP and send only to that display.
- **`api.ts` + `settings/index.html`** — the app settings page calls `getEditorUrl` via `Homey.api()`; routes are declared in the `api` section of `.homeycompose/app.json`.

## Conventions and gotchas

- Device registration survives restarts via "pre-registration": `DisplayDevice.onInit()` re-registers its IP before the display's WebSocket reconnects.
- Light levels use two scales: the frontend sends discrete levels 0–3 (OFF/LOW/MED/FULL) which the server maps to Homey's 0–1 range as `[0, 0.05, 0.50, 1.00]`, and back again for `lightLevelComplete`.
- Flow card boolean arguments may arrive as the strings `'true'`/`'false'`; `sceneComplete()` converts them.
- Everything in `public/` (kiosk UI, editor SPA, pending page, images) is plain static HTML/JS — no frontend build step.
