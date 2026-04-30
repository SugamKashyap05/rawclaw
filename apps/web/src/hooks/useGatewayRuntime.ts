import { useEffect, useRef, useState } from 'react';
import { GatewayEvent, GatewayRouteDetail, GatewayRouteSummary, GatewayStreamEvent, SessionBinding } from '@rawclaw/shared';
import { fetchGatewayRouteDetail, fetchGatewayRoutes, fetchRecentGatewayEvents, streamGatewayEvents } from '../lib/gateway';
import {
  EMPTY_GATEWAY_SUMMARY,
  isGatewayHeartbeat,
  mergeGatewayEvents,
  publishDesktopGatewayAlert,
  shouldRefreshRoutesForEvent,
  summarizeGatewayRoutes,
} from '../lib/gateway-runtime';

type UseGatewayRuntimeOptions = {
  selectedRouteId?: string | null;
  enableStream?: boolean;
};

export function useGatewayRuntime(options: UseGatewayRuntimeOptions = {}) {
  const { selectedRouteId = null, enableStream = true } = options;
  const [routes, setRoutes] = useState<SessionBinding[]>([]);
  const [summary, setSummary] = useState<GatewayRouteSummary>(EMPTY_GATEWAY_SUMMARY);
  const [recentEvents, setRecentEvents] = useState<GatewayEvent[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<GatewayRouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [isStreamLive, setIsStreamLive] = useState(false);

  const refreshTimeoutRef = useRef<number | null>(null);
  const selectedRouteIdRef = useRef<string | null>(selectedRouteId);
  const childRouteIdsRef = useRef<string[]>([]);

  const loadSnapshot = async () => {
    setLoading(true);
    setError(null);
    try {
      const [routePayload, events] = await Promise.all([
        fetchGatewayRoutes(),
        fetchRecentGatewayEvents(60),
      ]);
      setRoutes(routePayload.routes);
      setSummary(routePayload.summary || summarizeGatewayRoutes(routePayload.routes));
      setRecentEvents(mergeGatewayEvents([], events));
    } catch (loadError) {
      console.error('Failed to load gateway runtime snapshot', loadError);
      setError('Unable to load gateway runtime data right now.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (routeId: string) => {
    setDetailLoading(true);
    try {
      const detail = await fetchGatewayRouteDetail(routeId);
      setSelectedDetail(detail);
    } catch (loadError) {
      console.error('Failed to load gateway route detail', loadError);
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const scheduleRefresh = (bindingId?: string | null) => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      void loadSnapshot();
      const activeRouteId = selectedRouteIdRef.current;
      const childRouteIds = childRouteIdsRef.current;
      if (activeRouteId && (!bindingId || bindingId === activeRouteId || childRouteIds.includes(bindingId))) {
        void loadDetail(activeRouteId);
      }
    }, 350);
  };

  useEffect(() => {
    void loadSnapshot();
    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedRouteId) {
      setSelectedDetail(null);
      return;
    }
    void loadDetail(selectedRouteId);
  }, [selectedRouteId]);

  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);

  useEffect(() => {
    childRouteIdsRef.current = selectedDetail?.childRoutes.map((child) => child.id) || [];
  }, [selectedDetail]);

  useEffect(() => {
    if (!enableStream) {
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: number | null = null;

    const connect = async () => {
      setStreamError(null);
      try {
        await streamGatewayEvents(
          (message: GatewayStreamEvent) => {
            if (isGatewayHeartbeat(message)) {
              setIsStreamLive(true);
              setStreamError(null);
              setLastEventAt(message.timestamp);
              return;
            }

            setIsStreamLive(true);
            setStreamError(null);
            setLastEventAt(message.timestamp);
            setRecentEvents((current) => mergeGatewayEvents(current, [message]));
            publishDesktopGatewayAlert(message);
            if (shouldRefreshRoutesForEvent(message)) {
              scheduleRefresh(message.bindingId);
            }
          },
          controller.signal,
        );

        if (!controller.signal.aborted) {
          setIsStreamLive(false);
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, 1500);
        }
      } catch (streamFailure) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Gateway event stream disconnected', streamFailure);
        setIsStreamLive(false);
        setStreamError('Live gateway stream disconnected. Retrying...');
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 2000);
      }
    };

    void connect();

    return () => {
      controller.abort();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [enableStream]);

  return {
    routes,
    summary,
    recentEvents,
    selectedDetail,
    loading,
    detailLoading,
    error,
    streamError,
    isStreamLive,
    lastEventAt,
    refresh: loadSnapshot,
  };
}
