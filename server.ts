import express, { Application, Request, Response, NextFunction } from 'express';
import path from 'path';
import { Server } from 'http';
import { EventEmitter } from "events";
import { TypedEmitter } from "tiny-typed-emitter";
import { WebSocketServer, WebSocket } from 'ws';



type KioskEvents = {
  scene: (name: string, active: boolean) => void;
  light: (strength: number) => void;
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
  type: 'scene-complete' | 'light-complete';
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

  constructor(port: number = 8123) {
    super();

    this.app = express();
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
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

    // Serve static files from the public directory
    this.app.use(express.static(path.join(__dirname, "public")));

    // --- SPA fallback (Express 5-safe) ---
    this.app.get(/.*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "public", "index.html"));
    });
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

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      ws.on('message', (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Send initial connection confirmation
      this.sendToClient(ws, {
        type: 'scene-complete',
        data: { name: 'connected', active: true }
      });
    });
  }

  private handleWebSocketMessage(message: WebSocketMessage): void {
    console.log('Received WebSocket message:', message);

    switch (message.type) {
      case 'scene':
        if (message.data.name !== undefined && message.data.active !== undefined) {
          this.emit('scene', message.data.name, message.data.active);
        }
        break;

      case 'light':
        if (message.data.strength !== undefined) {
          // Convert discrete level (0-3) to custom 0-1 range for Homey
          const lightLevels = [0, 0.05, 0.50, 1.00]; // OFF, LOW, MEDIUM, FULL
          const normalizedStrength = lightLevels[message.data.strength] || 0;
          this.emit('light', normalizedStrength);
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

  private broadcastToClients(response: WebSocketResponse): void {
    this.clients.forEach(client => {
      this.sendToClient(client, response);
    });
  }


  sceneComplete(name: string, active: boolean | string) {
    // Convert string 'true'/'false' to actual boolean
    const isActive = typeof active === 'string' ? active === 'true' : active;
    
    console.log(`Scene complete called with name: ${name}, active: ${active} (converted to boolean: ${isActive})`);

    // Broadcast to all connected WebSocket clients
    this.broadcastToClients({
      type: 'scene-complete',
      data: {
        name,
        active: isActive
      }
    });
  }

  lightLevelComplete(strength: number) {
    console.log(`Light level complete called with strength: ${strength}`);

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

    // Broadcast to all connected WebSocket clients
    this.broadcastToClients({
      type: 'light-complete',
      data: { strength: discreteLevel }
    });
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