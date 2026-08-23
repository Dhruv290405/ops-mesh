'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE } from './api';

type Handler = (payload: any) => void;

interface SocketCtx {
  connected: boolean;
  on: (type: string, handler: Handler) => () => void;
}

const Ctx = createContext<SocketCtx>({ connected: false, on: () => () => {} });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const handlers = useRef<Map<string, Set<Handler>>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(API_BASE, {
      transports: ['websocket'],
      withCredentials: true,
      reconnectionDelay: 1500,
      path: '/socket.io'
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Forward every realtime event type to subscribers.
    socket.onAny((type: string, msg: any) => {
      const set = handlers.current.get(type);
      if (set) {
        const payload = msg?.payload ?? msg;
        set.forEach((h) => {
          try {
            h(payload);
          } catch {
            /* ignore handler errors */
          }
        });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const on = useCallback((type: string, handler: Handler) => {
    if (!handlers.current.has(type)) handlers.current.set(type, new Set());
    handlers.current.get(type)!.add(handler);
    return () => {
      handlers.current.get(type)?.delete(handler);
    };
  }, []);

  return <Ctx.Provider value={{ connected, on }}>{children}</Ctx.Provider>;
}

export function useSocket() {
  return useContext(Ctx);
}

/**
 * Subscribe to a realtime event type for the lifetime of the component.
 * `handler` is kept in a ref so changing its identity doesn't resubscribe.
 */
export function useRealtime(type: string, handler: Handler) {
  const { on } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    return on(type, (payload) => ref.current(payload));
  }, [type, on]);
}
