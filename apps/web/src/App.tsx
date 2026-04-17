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
import Integrations from './pages/Integrations';
import Sandbox from './pages/Sandbox';
import Settings from './pages/Settings';
import Tools from './pages/Tools';
import ModelSelector from './components/ModelSelector';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { bootstrapWorkspace, getBootstrapStatus, initializeAuth } from './lib/auth';
import { SystemStatusSnapshot } from '@rawclaw/shared';

function App() {
  const [selectedModel, setSelectedModel] = useState<string>('complexity:medium');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [top_p, setTopP] = useState<number>(0.9);
  const [isAuth, setIsAuth] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [setupUser, setSetupUser] = useState<string>('');
  const [setupMemory, setSetupMemory] = useState<string>('');
  const [setupSaving, setSetupSaving] = useState<boolean>(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatusSnapshot | null>(null);
  const location = useLocation();

  const bootstrap = async () => {
    setAuthLoading(true);
    try {
      const status = await getBootstrapStatus();
      const ok = await initializeAuth();
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
    if (location.pathname.startsWith('/mcp') || location.pathname.startsWith('/tools')) return 'MCP Servers';
    if (location.pathname.startsWith('/skills')) return 'Skills';
    if (location.pathname.startsWith('/memory')) return 'Memory';
    if (location.pathname.startsWith('/models')) return 'Models';
    if (location.pathname.startsWith('/integrations')) return 'Integrations';
    if (location.pathname.startsWith('/sandbox')) return 'Sandbox';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    if (location.pathname.startsWith('/tasks')) return 'Tasks';
    return 'Dashboard';
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
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
        <div className="glass-card" style={{ width: '100%', maxWidth: '760px' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>Initialize RawClaw</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
            This runs only once, when your workspace has not been initialized yet. We will seed <span className="mono">USER.md</span> and optionally your starter memory so the system can boot into a real working state.
          </p>
          <div style={{ display: 'grid', gap: '0.9rem' }}>
            <div>
              <label className="mono" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.72rem' }}>
                USER.md
              </label>
              <textarea
                value={setupUser}
                onChange={(event) => setSetupUser(event.target.value)}
                rows={8}
                placeholder="Describe who you are, your working preferences, project context, and anything RawClaw should remember about you."
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </div>
            <div>
              <label className="mono" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.72rem' }}>
                MEMORY.md (optional)
              </label>
              <textarea
                value={setupMemory}
                onChange={(event) => setSetupMemory(event.target.value)}
                rows={6}
                placeholder="Optional starter memory, project facts, or operating constraints."
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary"
                disabled={setupSaving || !setupUser.trim()}
                onClick={async () => {
                  setSetupSaving(true);
                  const ok = await bootstrapWorkspace({
                    user: setupUser,
                    memory: setupMemory || undefined,
                  });
                  setSetupSaving(false);
                  if (ok) {
                    setNeedsSetup(false);
                    setIsAuth(true);
                  } else {
                    window.alert('Workspace initialization failed.');
                  }
                }}
              >
                {setupSaving ? 'Initializing...' : 'Initialize workspace'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', maxHeight: '100vh', overflow: 'hidden' }}>
      <Sidebar counts={systemStatus?.counts} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            padding: '1rem 1.4rem',
            borderBottom: '1px solid var(--border-glass)',
            background: 'rgba(8, 8, 14, 0.88)',
            backdropFilter: 'blur(14px)',
            position: 'relative',
            zIndex: 60,
            overflow: 'visible',
          }}
        >
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.2rem' }}>{pageTitle}</div>
            <div style={{ color: 'var(--text-muted)' }}>
              Use the rebuilt command center to operate agents, memory, tools, models, and tasks.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: '320px', position: 'relative', overflow: 'visible' }}>
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
            <NavLink to="/chat" className="btn-primary" style={{ textDecoration: 'none' }}>
              New Chat
            </NavLink>
          </div>
        </header>

        <main className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route 
              path="/chat/:sessionId?" 
              element={<Chat selectedModel={selectedModel} temperature={temperature} top_p={top_p} />} 
            />
            <Route path="/agents" element={<Agents />} />
            <Route path="/mcp" element={<MCPServers />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/models" element={<Models />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/sandbox" element={<Sandbox />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <StatusBar onStatus={setSystemStatus} />
      </div>
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

export default App;
