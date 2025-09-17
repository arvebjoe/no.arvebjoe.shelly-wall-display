import express, { Application, Request, Response, NextFunction } from 'express';
import path from 'path';
import { Server } from 'http';

export class KioskServer {
  private app: Application;
  private server: Server | null = null;
  private port: number;
  private pingCounter: number = 0;

  constructor(port: number = 8123) {
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
    this.app.use(express.static(path.join(__dirname, "..", "public")));

    // --- SPA fallback (Express 5-safe) ---
    this.app.get(/.*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, "0.0.0.0", () => {
          console.log(`Kiosk server on http://0.0.0.0:${this.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
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