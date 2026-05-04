import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type DesktopGatewayAlert = {
  source?: string;
  type?: string;
  title?: string;
  body?: string;
  routePath?: string;
};

const WEB_APP_ORIGIN = 'http://localhost:5173';
const DESKTOP_ROUTES = [
  { label: 'Chat', path: '/' },
  { label: 'App Builder', path: '/app-builder' },
  { label: 'Gateway', path: '/gateway' },
  { label: 'Operator', path: '/operator' },
  { label: 'Tasks', path: '/tasks' },
  { label: 'Learning', path: '/learning' },
] as const;

const App: React.FC = () => {
  const [version, setVersion] = useState<string>('');
  const [pendingAlertRoute, setPendingAlertRoute] = useState<string | null>(null);
  const [pendingAlertTitle, setPendingAlertTitle] = useState<string>('');
  const [iframePath, setIframePath] = useState<string>('/');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    invoke<string>('get_version').then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent<DesktopGatewayAlert>) => {
      if (event.origin !== WEB_APP_ORIGIN) {
        return;
      }

      const payload = event.data;
      if (payload?.source !== 'rawclaw-web' || payload?.type !== 'gateway-runtime-alert') {
        return;
      }

      const title = payload.title || 'RawClaw Gateway Alert';
      const body = payload.body || 'A new runtime alert needs attention.';
      const routePath = payload.routePath || '/gateway';

      setPendingAlertTitle(title);
      setPendingAlertRoute(routePath);

      try {
        await invoke('show_notification', { title, body });
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const iframeSrc = useMemo(() => `${WEB_APP_ORIGIN}${iframePath}`, [iframePath]);

  const navigateIframe = (routePath: string) => {
    setIframePath(routePath);
    if (iframeRef.current) {
      iframeRef.current.src = `${WEB_APP_ORIGIN}${routePath}`;
    }
  };

  const handleNotification = async () => {
    try {
      await invoke('show_notification', { title: 'RawClaw', body: 'Desktop notifications are active.' });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#090b13' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          backgroundColor: '#10141f',
          borderBottom: '1px solid #1e2535',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>RawClaw</span>
          <span style={{ fontSize: '12px', color: '#8a93a6' }}>v{version}</span>
          <span style={{ fontSize: '12px', color: '#5fe1ff' }}>Phase 3 runtime desktop shell</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {pendingAlertRoute ? (
            <button
              onClick={() => navigateIframe(pendingAlertRoute)}
              style={buttonStyle}
              title={pendingAlertTitle || 'Open latest gateway alert'}
            >
              Open Latest Alert
            </button>
          ) : null}
          {DESKTOP_ROUTES.map((route) => (
            <button
              key={route.path}
              onClick={() => navigateIframe(route.path)}
              style={{
                ...buttonStyle,
                borderColor: iframePath === route.path ? '#5fe1ff' : buttonStyle.border as string,
                color: iframePath === route.path ? '#5fe1ff' : '#fff',
              }}
            >
              {route.label}
            </button>
          ))}
          <button onClick={handleNotification} style={buttonStyle}>
            Test Notification
          </button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        style={{ flex: 1, border: 'none', backgroundColor: '#fff' }}
        title="RawClaw Web App"
      />
    </div>
  );
};

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2d3950',
  borderRadius: '8px',
  padding: '6px 12px',
  cursor: 'pointer',
  color: '#fff',
  fontSize: '12px',
};

export default App;
