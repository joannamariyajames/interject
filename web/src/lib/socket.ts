import type { ClientFrame, ServerFrame } from "./types";

type Handler = (frame: ServerFrame) => void;
type StatusHandler = (status: "connecting" | "open" | "closed") => void;

function endpoint() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/**
 * Thin websocket wrapper with backoff.
 *
 * The one behaviour worth calling out: `send` never queues behind anything.
 * An interrupt frame has to reach the server on the same tick the user asked
 * for it, or the "stop talking" latency this whole project is about stops
 * being measurable.
 */
export class AgentSocket {
  private socket: WebSocket | null = null;
  private handler: Handler;
  private onStatus: StatusHandler;
  private retries = 0;
  private closedByUs = false;

  constructor(handler: Handler, onStatus: StatusHandler) {
    this.handler = handler;
    this.onStatus = onStatus;
  }

  connect() {
    this.closedByUs = false;
    this.onStatus("connecting");
    const socket = new WebSocket(endpoint());
    this.socket = socket;

    socket.onopen = () => {
      this.retries = 0;
      this.onStatus("open");
    };
    socket.onmessage = (event) => {
      try {
        this.handler(JSON.parse(event.data) as ServerFrame);
      } catch {
        /* a malformed frame is not worth tearing the session down for */
      }
    };
    socket.onclose = () => {
      this.onStatus("closed");
      if (this.closedByUs) return;
      const delay = Math.min(800 * 2 ** this.retries++, 8000);
      setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => socket.close();
  }

  send(frame: ClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  close() {
    this.closedByUs = true;
    this.socket?.close();
  }
}
