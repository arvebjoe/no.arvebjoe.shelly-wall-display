# Shelly Wall Display - Gym & Cinema Control

A Homey app that provides a custom web interface for controlling gym and home theater scenes through a Shelly Wall Display. The app creates a kiosk-style interface with light controls and scene buttons, communicating with Homey flows via WebSocket.

## Overview

This app transforms a Shelly Wall Display into a dedicated control panel for gym and cinema scenes. It includes:
- **Light level control** with visual feedback (0-100% range mapped to Homey's 0-1 scale)
- **Scene toggle buttons** for gym and cinema modes
- **Real-time WebSocket communication** between frontend and Homey
- **Home Assistant compatibility layer** for Shelly Wall Display integration

## Architecture

### System Flow
```
Shelly Wall Display → WebSocket → Express Server → Events → Homey Flow WHEN Cards → Devices

Homey Flow THEN Cards → Method calls → Express server → WebSocket → Shelly Wall Display 
```

1. **Frontend (HTML/CSS/JS)**: User interacts with touch interface on Shelly Wall Display
2. **Express Server**: Handles HTTP serving (initial load) and WebSocket communication (real-time control)
3. **Homey Integration**: Processes WebSocket events and triggers flow cards
4. **Device Control**: Homey flows control actual lights and scenes

## Home Assistant Handshake Emulation

The Shelly Wall Display expects a Home Assistant-compatible web server. Our Express server provides this compatibility:

### HTTP Endpoints
- `GET /` - Serves the main kiosk interface (`public/index.html`)
- `GET /api/websocket` - Home Assistant WebSocket API endpoint (returns 200 OK)
- `GET /auth/*` - Authentication endpoints (returns 200 OK)
- `GET /static/*` - Static file serving for images and assets

### Key Compatibility Features
- **CORS headers** for cross-origin requests
- **WebSocket upgrade** handling for real-time communication
- **Static file serving** for custom images (cinema.png, gym.png, light_on.png, light_off.png)
- **404 handling** that doesn't break the Shelly display

The Shelly Wall Display performs an initial handshake check and then loads the web interface. Our server responds to these requests appropriately, allowing the display to function as intended.

## Homey Flow Cards

### Trigger Cards (Events from Frontend)
1. **"Scene Selected"** (`scene-selected`)
   - Triggered when user taps a scene button
   - Tokens: `scene` (text), `active` (boolean)
   - Use case: Start/stop gym or cinema scenes based on user input

2. **"Light Level Changed"** (`light-level-changed`)
   - Triggered when user moves the light slider
   - Tokens: `strength` (number, 0-1 range)
   - Use case: Adjust room lighting to selected level

### Action Cards (Commands to Frontend)
1. **"Scene Complete"** (`scene-complete`)
   - Updates frontend to show scene activation status
   - Arguments: `name` (scene name), `active` (boolean)
   - Use case: Provide visual feedback when scene changes complete

2. **"Light Level Complete"** (`light-level-complete`)
   - Updates frontend light slider position
   - Arguments: `strength` (number, 0-3 range for frontend)
   - Use case: Sync slider with actual light levels from other sources

## Frontend Implementation

### Layout Structure
The interface uses CSS Grid with three columns:
- **Column 1**: Vertical light slider with custom bulb imagery
- **Column 2**: Cinema scene button with image
- **Column 3**: Gym scene button with image

### Key Features
1. **Custom Light Slider**
   - Vertical orientation optimized for wall display
   - Visual feedback with light bulb imagery (off/on states)
   - Touch and mouse support with drag interaction
   - 4 levels: OFF (0), LOW (1), MEDIUM (2), FULL (3)

2. **Scene Toggle Buttons**
   - Large touch targets with custom images
   - Visual states: inactive (grayscale), active (full color), pressed (scaled)
   - Toggle functionality - buttons can be turned on/off

3. **WebSocket Communication**
   - Real-time bidirectional communication
   - Automatic reconnection with visual overlay
   - Infinite retry logic for robust connection

4. **Responsive Design**
   - Optimized for Shelly Wall Display resolution
   - Touch-friendly interface elements
   - Dark theme suitable for wall mounting

### WebSocket Message Protocol
```javascript
// Frontend to Backend
{ type: "scene", data: { name: "gym", active: true } }
{ type: "light", data: { strength: 2 } }

// Backend to Frontend  
{ type: "scene-complete", data: { name: "gym", active: true } }
{ type: "light-complete", data: { strength: 2 } }
```

## Data Flow: Frontend → Backend → Homey

### Scene Control Flow
1. **User Action**: Taps gym/cinema button on wall display
2. **Frontend**: Sends WebSocket message `{ type: "scene", data: { name: "gym", active: true } }`
3. **Express Server**: Receives WebSocket message, emits `scene-selected` event
4. **Homey App**: Catches event, triggers "Scene Selected" flow card
5. **Homey Flow**: Executes scene logic (lights, devices, etc.)
6. **Homey Flow**: Calls "Scene Complete" action card when done
7. **Express Server**: Receives completion, sends WebSocket message back
8. **Frontend**: Updates button visual state to show active scene

### Light Control Flow
1. **User Action**: Drags light slider on wall display
2. **Frontend**: Converts position to level (0-3), sends WebSocket message
3. **Express Server**: Maps frontend level (0-3) to Homey range (0-1)
4. **Homey App**: Triggers "Light Level Changed" flow card
5. **Homey Flow**: Adjusts actual lighting devices
6. **Homey Flow**: Optionally calls "Light Level Complete" for confirmation
7. **Frontend**: Slider position updated if needed

### Light Level Mapping
The system uses different scales for frontend UX vs. Homey compatibility:
- **Frontend**: 0 (OFF), 1 (LOW), 2 (MEDIUM), 3 (FULL)
- **Homey**: 0.00, 0.05, 0.50, 1.00

This mapping provides intuitive user control while maintaining Homey's 0-1 device standard.

## Type Safety & Error Handling

- **TypeScript implementation** for server-side type safety
- **String-to-boolean conversion** for Homey flow card compatibility
- **WebSocket reconnection** with exponential backoff
- **Error logging** for debugging WebSocket and flow issues
- **Graceful degradation** when WebSocket connection fails

## Installation & Setup

1. Install the app in Homey
2. Configure your Shelly Wall Display to point to Homey's IP address
3. Create flows using the provided trigger and action cards
4. Customize the `public/` assets (images) as needed
5. The app automatically starts the Express server on port 3000

## File Structure
```
├── app.ts              # Homey app integration & flow cards
├── server.ts           # Express server & WebSocket handling  
├── public/
│   ├── index.html      # Main kiosk interface
│   ├── cinema.png      # Cinema scene button image
│   ├── gym.png         # Gym scene button image
│   ├── light_on.png    # Light bulb "on" state
│   └── light_off.png   # Light bulb "off" state
├── package.json        # Dependencies & scripts
└── tsconfig.json       # TypeScript configuration
```

## Development

The app uses:
- **Express.js 5.1.0** for HTTP server
- **ws 8.16.0** for WebSocket implementation  
- **tiny-typed-emitter** for type-safe event handling
- **TypeScript** for development-time type safety

For debugging, check the Homey app logs and browser console for WebSocket connection status and message flow.