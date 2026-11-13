import { API_URL } from "./api";
import type { ClientEvent, ConnectionStatus, ServerEvent } from "./types";

type Handlers = {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  onUnauthorized: () => void;
};

const PING_MS = 25_000;

/** Typed realtime client matching the server protocol; reconnects with backoff and queues messages. */
export class ChatSocket {
  private socket: WebSocket | null = null;
  private ready = false;
  private closedByUser = false;
  private retry = 0;
  private outbox: ClientEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly token: string, private readonly handlers: Handlers) {}

  connect(): void {
    if (this.closedByUser) return;
    this.handlers.onStatus(this.retry === 0 ? "connecting" : "reconnecting");
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(this.token)}`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onmessage = (event) => {
      let message: ServerEvent;
      try {
        message = JSON.parse(String(event.data)) as ServerEvent;
      } catch {
        return;
      }
      if (message.type === "ready") {
        this.ready = true;
        this.retry = 0;
        this.handlers.onStatus("online");
        this.outbox.splice(0).forEach((item) => this.send(item));
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_MS);
      }
      this.handlers.onEvent(message);
    };

    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      this.ready = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.closedByUser) return;
      if (event.code === 4001) {
        this.handlers.onUnauthorized();
        return;
      }
      const delay = Math.min(15_000, 500 * 2 ** this.retry++) + Math.random() * 300;
      this.handlers.onStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  send(event: ClientEvent): void {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    } else if (event.type === "message.send") {
      this.outbox.push(event);
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}
