import { useEffect, useRef, useState } from "react";
import type { WsEnvelope } from "./types";

interface UseSocketOptions {
  url: string;
  onEvent: (envelope: WsEnvelope) => void;
  enabled?: boolean;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

interface UseSocketResult {
  connectionState: ConnectionState;
}

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

export function useSocket({ url, onEvent, enabled = true }: UseSocketOptions): UseSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const attemptRef = useRef(0);
  const everConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setConnectionState(everConnectedRef.current ? "reconnecting" : "connecting");
      socket = new WebSocket(url);

      socket.onopen = () => {
        everConnectedRef.current = true;
        attemptRef.current = 0;
        setConnectionState("connected");
      };

      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as WsEnvelope;
          onEventRef.current(envelope);
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        const delay = BACKOFF_STEPS[Math.min(attemptRef.current, BACKOFF_STEPS.length - 1)];
        attemptRef.current += 1;
        setConnectionState("reconnecting");
        timer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [url, enabled]);

  return { connectionState };
}
