import express, { Application, Request, Response, NextFunction } from 'express';
import path from 'path';
import { Server } from 'http';
import { EventEmitter } from "events";
import { TypedEmitter } from "tiny-typed-emitter";
import { WebSocketServer, WebSocket } from 'ws';
import { LayoutStore } from './src/layout-store';
import { SCREEN_SIZES, createDefaultLayout, validateLayout, GuiLayout } from './src/layout-types';
import { renderLayoutHtml } from './src/renderer';



type KioskEvents = {
  scene: (ip: string, name: string, active: boolean) => void;
  light: (ip: string, strength: number) => void;
  newDevice: (ip: string) => void;
  deviceRegistered: (ip: string) => void;
  deviceUnregistered: (ip: string) => void;
}

type DeviceInfo = {
  ip: string;
  name?: string;
  registered: boolean;
  lastSeen: Date;
  failedPings: number;
  ws?: WebSocket;
}

type WebSocketMessage = {
  type: 'scene' | 'light';
  data: {
    name?: string;
    active?: boolean;
    strength?: number;
  };
}

type WebSocketResponse = {
  type: 'scene-complete' | 'light-complete' | 'reload';
  data: {
    name?: string;
    active?: boolean;
    strength?: number;
  };
}

export class KioskServer extends (EventEmitter as new () => TypedEmitter<KioskEvents>) {

  private app: Application;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private pingCounter: number = 0;
  private clients: Set<WebSocket> = new Set();
  private devices: Map<string, DeviceInfo> = new Map();
  private preRegisteredDevices: Set<string> = new Set(); // Devices marked as registered before connecting
  private deviceNames: Map<string, string> = new Map(); // Homey device names by IP
  private pingInterval: NodeJS.Timeout | null = null;
  private layoutStore: LayoutStore;

  constructor(port: number = 8123, layoutStore?: LayoutStore) {
    super();

    this.app = express();
    this.port = port;
    this.layoutStore = layoutStore ?? new LayoutStore();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Parse JSON bodies (used by the editor API); must come before the
    // catch-all text parser, which skips bodies that are already parsed.
    this.app.use(express.json({ limit: "512kb" }));

    // Parse text body with limit
    this.app.use(express.text({ type: "*/*", limit: "50kb" }));

    // Logging middleware
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
      next();
    });
  }

  private setupRoutes(): void {

    // --- Minimal HA identity endpoints (so Shelly accepts us) ---
    this.app.get("/auth/providers", (_req: Request, res: Response) => {
      res.status(200).json([{ name: "Local", id: null, type: "homeassistant" }]);
    });

    this.app.post("/auth/login_flow", (_req: Request, res: Response) => {
      const flowId = "dummy-" + Math.random().toString(36).slice(2, 10);
      res.status(200).json({
        type: "form",
        flow_id: flowId,
        handler: ["homeassistant", null],
        step_id: "init",
        data_schema: [
          { name: "username", type: "string" },
          { name: "password", type: "string" },
        ],
        description_placeholders: null,
      });
    });

    this.app.post("/auth/login_flow/:flow_id", (req: Request, res: Response) => {
      res.status(200).json({
        type: "create_entry",
        flow_id: req.params.flow_id,
        result: { type: "finish" }
      });
    });

    this.app.head("/auth/login_flow", (_req: Request, res: Response) => res.sendStatus(200));
    this.app.head("/auth/providers", (_req: Request, res: Response) => res.sendStatus(200));

    // Health check with counter
    this.app.get("/api/health", (_req: Request, res: Response) => {
      this.pingCounter++;
      res.json({
        ok: true,
        counter: this.pingCounter,
        timestamp: new Date().toISOString()
      });
    });

    // --- Static frontend ---
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store");
      next();
    });

    // Serve static files (images, etc.) from the public directory
    this.app.use(express.static(path.join(__dirname, "public"), {
      index: false // Don't serve index.html automatically
    }));

    // --- GUI editor ---
    this.setupEditorRoutes();

    // --- Device-aware routing ---
    this.app.get(/.*/, async (req: Request, res: Response) => {
      // Extract client IP
      const clientIp = this.extractClientIp(req);

      // Check device registration status. A device paired in Homey is
      // pre-registered even before its WebSocket has connected.
      const device = this.devices.get(clientIp);
      const registered = device?.registered || this.preRegisteredDevices.has(clientIp);

      if (!registered) {
        // Unknown or not-yet-registered device - show pending page
        // (device will be added when its WebSocket connects)
        res.sendFile(path.join(__dirname, "public", "pending.html"));
        return;
      }

      // Device is registered - serve its custom GUI if one has been
      // created in the editor, otherwise fall back to the default UI.
      if (await this.layoutStore.hasLayout(clientIp)) {
        res.sendFile(this.layoutStore.htmlPath(clientIp));
      } else {
        res.sendFile(path.join(__dirname, "public", "index.html"));
      }
    });
  }

  private setupEditorRoutes(): void {
    // The editor single-page app
    this.app.get("/editor", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "public", "editor.html"));
    });

    // Devices that can be edited (known to the server or paired in Homey)
    this.app.get("/api/editor/devices", async (_req: Request, res: Response) => {
      const ips = new Set<string>([
        ...this.devices.keys(),
        ...this.preRegisteredDevices,
      ]);

      const devices = await Promise.all([...ips].map(async (ip) => {
        const device = this.devices.get(ip);
        return {
          ip,
          name: this.deviceNames.get(ip) || device?.name || null,
          registered: device ? device.registered : this.preRegisteredDevices.has(ip),
          connected: !!(device?.ws && device.ws.readyState === WebSocket.OPEN),
          hasLayout: await this.layoutStore.hasLayout(ip),
        };
      }));

      res.json(devices);
    });

    // Screen size presets for the editor dropdown
    this.app.get("/api/editor/screens", (_req: Request, res: Response) => {
      res.json(SCREEN_SIZES);
    });

    // Load the stored layout for a device (or a default template)
    this.app.get("/api/editor/layouts/:ip", async (req: Request, res: Response) => {
      try {
        const layout = await this.layoutStore.loadLayout(req.params.ip);
        if (layout) {
          res.json({ exists: true, layout });
        } else {
          res.json({ exists: false, layout: createDefaultLayout() });
        }
      } catch (error) {
        res.status(400).json({ error: String(error) });
      }
    });

    // Save a layout: validates, stores JSON + rendered HTML, reloads the display
    this.app.put("/api/editor/layouts/:ip", async (req: Request, res: Response) => {
      const layout = req.body as GuiLayout;
      const errors = validateLayout(layout);
      if (errors.length > 0) {
        res.status(400).json({ ok: false, errors });
        return;
      }

      try {
        await this.layoutStore.saveLayout(req.params.ip, layout);
      } catch (error) {
        console.error('Failed to save layout:', error);
        res.status(500).json({ ok: false, errors: [String(error)] });
        return;
      }

      // Tell the display to reload so the new GUI shows up immediately
      this.sendReload(req.params.ip);
      res.json({ ok: true });
    });

    // Render a live preview without saving (WebSocket runtime disabled)
    this.app.post("/api/editor/preview", (req: Request, res: Response) => {
      const layout = req.body as GuiLayout;
      const errors = validateLayout(layout);
      if (errors.length > 0) {
        res.status(400).json({ ok: false, errors });
        return;
      }
      res.type("html").send(renderLayoutHtml(layout, { preview: true }));
    });
  }

  private sendReload(ip: string): void {
    const device = this.devices.get(ip);
    if (device?.ws && device.ws.readyState === WebSocket.OPEN) {
      this.sendToClient(device.ws, { type: 'reload', data: {} });
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, "0.0.0.0", () => {
          console.log(`Kiosk server on http://0.0.0.0:${this.port}`);

          // Setup WebSocket server
          this.setupWebSocket();

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          console.log('WebSocket server closed');
        });
        this.wss = null;
      }

      // Close all WebSocket connections
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });
      this.clients.clear();

      // Clear device registry
      this.devices.clear();

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          console.log('Kiosk server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private setupWebSocket(): void {
    if (!this.server) return;

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = this.extractClientIp(req);
      console.log(`WebSocket client connected from ${clientIp}`);
      this.clients.add(ws);

      // Register or update device
      let device = this.devices.get(clientIp);
      if (!device) {
        // New device detected - check if it's pre-registered
        const isPreRegistered = this.preRegisteredDevices.has(clientIp);
        
        device = {
          ip: clientIp,
          name: this.deviceNames.get(clientIp),
          registered: isPreRegistered, // Use pre-registration status
          lastSeen: new Date(),
          failedPings: 0,
          ws: ws
        };
        this.devices.set(clientIp, device);
        console.log(`New device detected: ${clientIp}, pre-registered: ${isPreRegistered}`);
        
        if (!isPreRegistered) {
          // Only emit newDevice if it wasn't pre-registered
          this.emit('newDevice', clientIp);
        } else {
          // Send registered status immediately
          this.sendDeviceStatus(clientIp);
        }
      } else {
        // Existing device reconnected
        device.lastSeen = new Date();
        device.failedPings = 0;
        device.ws = ws;
      }

      ws.on('message', (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleWebSocketMessage(message, clientIp);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('pong', () => {
        const device = this.devices.get(clientIp);
        if (device) {
          device.lastSeen = new Date();
          device.failedPings = 0;
        }
      });

      ws.on('close', () => {
        console.log(`WebSocket client disconnected: ${clientIp}`);
        this.clients.delete(ws);
        const device = this.devices.get(clientIp);
        if (device) {
          device.ws = undefined;
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error from ${clientIp}:`, error);
        this.clients.delete(ws);
      });

      // Send initial status based on registration state
      this.sendDeviceStatus(clientIp);
    });

    // Start ping interval for health checks
    this.startPingInterval();
  }

  private handleWebSocketMessage(message: WebSocketMessage, clientIp: string): void {
    console.log(`Received WebSocket message from ${clientIp}:`, message);

    // Only process messages from registered devices
    const device = this.devices.get(clientIp);
    if (!device || !device.registered) {
      console.warn(`Ignoring message from unregistered device: ${clientIp}`);
      return;
    }

    switch (message.type) {
      case 'scene':
        if (message.data.name !== undefined && message.data.active !== undefined) {
          this.emit('scene', clientIp, message.data.name, message.data.active);
        }
        break;

      case 'light':
        if (message.data.strength !== undefined) {
          // Convert discrete level (0-3) to custom 0-1 range for Homey
          const lightLevels = [0, 0.05, 0.50, 1.00]; // OFF, LOW, MEDIUM, FULL
          const normalizedStrength = lightLevels[message.data.strength] || 0;
          this.emit('light', clientIp, normalizedStrength);
        }
        break;

      default:
        console.warn('Unknown WebSocket message type:', message.type);
    }
  }

  private sendToClient(client: WebSocket, response: WebSocketResponse): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(response));
    }
  }

  /** Sends a message to a single device's WebSocket, if it is connected. */
  private sendToDevice(ip: string, response: WebSocketResponse): void {
    const device = this.devices.get(ip);
    if (device?.ws && device.ws.readyState === WebSocket.OPEN) {
      this.sendToClient(device.ws, response);
    } else {
      console.warn(`Cannot send ${response.type} to ${ip}: device not connected`);
    }
  }


  sceneComplete(ip: string, name: string, active: boolean | string) {
    // Convert string 'true'/'false' to actual boolean
    const isActive = typeof active === 'string' ? active === 'true' : active;

    console.log(`Scene complete called for ${ip} with name: ${name}, active: ${active} (converted to boolean: ${isActive})`);

    this.sendToDevice(ip, {
      type: 'scene-complete',
      data: {
        name,
        active: isActive
      }
    });
  }

  lightLevelComplete(ip: string, strength: number) {
    console.log(`Light level complete called for ${ip} with strength: ${strength}`);

    // Convert 0-1 range back to discrete level (0-3) for frontend
    const lightLevels = [0, 0.05, 0.50, 1.00]; // OFF, LOW, MEDIUM, FULL
    let discreteLevel = 0;

    // Find the closest discrete level
    let minDiff = Math.abs(strength - lightLevels[0]);
    for (let i = 1; i < lightLevels.length; i++) {
      const diff = Math.abs(strength - lightLevels[i]);
      if (diff < minDiff) {
        minDiff = diff;
        discreteLevel = i;
      }
    }

    this.sendToDevice(ip, {
      type: 'light-complete',
      data: { strength: discreteLevel }
    });
  }

  private extractClientIp(req: any): string {
    // Try to get real IP from various headers (for proxies/reverse proxies)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fallback to socket remote address
    return req.socket.remoteAddress || 'unknown';
  }

  private sendDeviceStatus(ip: string): void {
    const device = this.devices.get(ip);
    if (!device || !device.ws) return;

    const status = device.registered ? 'registered' : 'pending';
    this.sendToClient(device.ws, {
      type: 'scene-complete',
      data: { name: `status-${status}`, active: true }
    });
  }

  private startPingInterval(): void {
    // Ping clients every 30 seconds
    this.pingInterval = setInterval(() => {
      this.devices.forEach((device, ip) => {
        if (device.ws && device.ws.readyState === WebSocket.OPEN) {
          device.ws.ping();
          device.failedPings++;

          // Remove device after 3 failed pings (90 seconds of no response)
          if (device.failedPings >= 3) {
            console.log(`Device ${ip} failed health check, removing`);
            device.ws.close();
            this.devices.delete(ip);
          }
        }
      });
    }, 30000);
  }

  // Public methods for device management
  public getPendingDevices(): DeviceInfo[] {
    const pending: DeviceInfo[] = [];
    this.devices.forEach(device => {
      if (!device.registered) {
        pending.push(device);
      }
    });
    return pending;
  }

  public registerDevice(ip: string, name?: string): boolean {
    // Mark device as pre-registered even if not connected yet
    this.preRegisteredDevices.add(ip);
    if (name) {
      this.deviceNames.set(ip, name);
    }

    const device = this.devices.get(ip);
    if (!device) {
      console.log(`Device ${ip} pre-registered (will be registered when it connects)`);
      return true; // Return true since we've marked it for registration
    }

    if (name) {
      device.name = name;
    }
    device.registered = true;
    console.log(`Device registered: ${ip}`);
    this.sendDeviceStatus(ip);
    this.emit('deviceRegistered', ip);
    return true;
  }

  public unregisterDevice(ip: string): void {
    // Remove from pre-registered list
    this.preRegisteredDevices.delete(ip);
    this.deviceNames.delete(ip);

    const device = this.devices.get(ip);
    if (device) {
      // Mark as unregistered but keep in devices map (don't close connection)
      device.registered = false;
      console.log(`Device unregistered: ${ip}`);

      // Notify the device to show pending page again
      this.sendDeviceStatus(ip);
      this.emit('deviceUnregistered', ip);
    } else {
      console.log(`Device ${ip} removed from pre-registration list`);
    }
  }

  public isDeviceRegistered(ip: string): boolean {
    const device = this.devices.get(ip);
    return device ? device.registered : false;
  }

  public getAllDevices(): Map<string, DeviceInfo> {
    return new Map(this.devices);
  }

  public getConnectedDevices(): string[] {
    const connected: string[] = [];
    this.devices.forEach((device, ip) => {
      if (device.ws && device.ws.readyState === WebSocket.OPEN) {
        connected.push(ip);
      }
    });
    return connected;
  }

  public getApp(): Application {
    return this.app;
  }

  public getPort(): number {
    return this.port;
  }

  public isRunning(): boolean {
    return this.server !== null;
  }
}