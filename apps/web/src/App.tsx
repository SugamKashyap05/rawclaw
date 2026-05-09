import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Tasks from './pages/Tasks';
import Models from './pages/Models';
import Memory from './pages/Memory';
import MCPServers from './pages/MCPServers';
import Agents from './pages/Agents';
import Skills from './pages/Skills';
import Provenance from './pages/Provenance';
import Gateway from './pages/Gateway';
import Operator from './pages/Operator';
import Integrations from './pages/Integrations';
import Sandbox from './pages/Sandbox';
import Settings from './pages/Settings';
import Tools from './pages/Tools';
import Learning from './pages/Learning';
import AppBuilder from './pages/AppBuilder';
import ModelSelector from './components/ModelSelector';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { BootstrapWizard } from './components/bootstrap/BootstrapWizard';
import { getBootstrapStatus, initializeAuth } from './lib/auth';
import { useHealthStatus } from './hooks/useHealthStatus';

function App() {
  const [selectedModel, setSelectedModel] = useState<string>('complexity:medium');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [top_p, setTopP] = useState<number>(0.9);
  const [isAuth, setIsAuth] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const location = useLocation();
  const { status: systemStatus, refresh: refreshHealth, isRefreshing: healthRefreshing, hasLoaded: healthLoaded } = useHealthStatus();

  const bootstrap = async () => {
    setAuthLoading(true);
    try {
      const ok = await initializeAuth();
      const status = await getBootstrapStatus();
      setIsAuth(ok);
      setNeedsSetup(status.needsSetup);
    } catch {
      setIsAuth(false);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    void bootstrap();
  }, []);

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith('/chat')) return 'Chat';
    if (location.pathname.startsWith('/agents')) return 'Agents';
    if (location.pathname.startsWith('/mcp')) return 'MCP Servers';
    if (location.pathname.startsWith('/tools')) return 'Tools';
    if (location.pathname.startsWith('/skills')) return 'Skills';
    if (location.pathname.startsWith('/memory')) return 'Memory';
    if (location.pathname.startsWith('/models')) return 'Models';
    if (location.pathname.startsWith('/learning')) return 'Learning';
    if (location.pathname.startsWith('/app-builder')) return 'App Builder';
    if (location.pathname.startsWith('/integrations')) return 'Integrations';
    if (location.pathname.startsWith('/sandbox')) return 'Sandbox';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    if (location.pathname.startsWith('/tasks')) return 'Tasks';
    if (location.pathname.startsWith('/gateway')) return 'Gateway Runtime';
    if (location.pathname.startsWith('/operator')) return 'Unified Operator Surface';
    if (location.pathname.startsWith('/provenance')) return 'Operator Control Room';
    return 'Command Center';
  }, [location.pathname]);

  const pageSubtitle = useMemo(() => {
    if (location.pathname.startsWith('/app-builder')) {
      return 'Describe the app, refine the workspace, and control the runtime from one builder surface.';
    }
    return 'Use RawClaw as a calm command console for memory, research, tasks, tools, and guided execution.';
  }, [location.pathname]);

  if (authLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
        <div className="glass-card" style={{ width: '100%', maxWidth: '460px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>Starting RawClaw</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Checking local workspace state and restoring your session.</p>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <BootstrapWizard onComplete={bootstrap} />;
  }

  if (!isAuth) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
        <div className="glass-card" style={{ width: '100%', maxWidth: '460px' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>Unable to restore local session</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
            RawClaw could not obtain a local access token from the API. Check that the API is running and that local auth is enabled in the environment.
          </p>
          <button className="btn-primary" onClick={() => void bootstrap()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isChatPage = location.pathname.startsWith('/chat');
  const isAppBuilderPage = location.pathname.startsWith('/app-builder');
  const isFixedViewportPage = isChatPage || isAppBuilderPage;

  return (
    <div
      className={isChatPage ? 'chat-page-shell' : ''}
      style={{
        display: 'flex',
        minHeight: '100vh',
        height: isFixedViewportPage ? '100vh' : undefined,
        maxHeight: isFixedViewportPage ? '100vh' : undefined,
        overflow: isFixedViewportPage ? 'hidden' : undefined,
      }}
    >
      <Sidebar counts={systemStatus.counts} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: isFixedViewportPage ? 'hidden' : 'auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.55rem 1rem',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(8, 8, 14, 0.88)',
            backdropFilter: 'blur(14px)',
            position: 'relative',
            zIndex: 60,
            overflow: 'visible',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.05rem' }}>
              {pageTitle}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', lineHeight: 1.25 }}>
              {pageSubtitle}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: '320px', position: 'relative', overflow: 'visible' }}>
            <ModelSelector
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              temperature={temperature}
              top_p={top_p}
              onParamsChange={(t, p) => {
                setTemperature(t);
                setTopP(p);
              }}
            />
            <NavLink
              to="/chat"
              className="btn-primary"
              style={{
                textDecoration: 'none',
                padding: '0.55rem 0.9rem',
              }}
            >
              New Chat
            </NavLink>
          </div>
        </header>

        <main style={{ flex: 1, minHeight: 0, overflow: isFixedViewportPage ? 'hidden' : 'auto', padding: '0.9rem', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route
              path="/chat/:sessionId?"
              element={<Chat selectedModel={selectedModel} temperature={temperature} top_p={top_p} systemStatus={systemStatus} />}
            />
            <Route path="/agents" element={<Agents />} />
            <Route path="/mcp" element={<MCPServers />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/models" element={<Models />} />
            <Route path="/learning" element={<Learning />} />
            <Route path="/app-builder/*" element={<AppBuilder />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/gateway" element={<Gateway />} />
            <Route path="/operator" element={<Operator />} />
            <Route path="/provenance" element={<Provenance />} />
            <Route path="/sandbox" element={<Sandbox />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <StatusBar status={systemStatus} onRefresh={refreshHealth} isRefreshing={healthRefreshing} isInitializing={!healthLoaded} />
      </div>
    </div>
  );
}

export default App;
