import { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Tools from './pages/Tools'
import ModelSelector from './components/ModelSelector'
import axios from 'axios'

function App() {
  const [selectedModel, setSelectedModel] = useState<string>('ollama/llama3');
  const [pendingConfirmations, setPendingConfirmations] = useState<number>(0);
  const location = useLocation();

  // Poll for pending confirmations
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await axios.get('/api/tools/confirm?sessionId=all');
        setPendingConfirmations(res.data?.length || 0);
      } catch {
        // Silently fail
      }
    };

    fetchPending();
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-container">
      <nav className="glass-nav">
        <div className="nav-brand">RawClaw</div>
        <div className="nav-links">
          <Link
            to="/"
            className={location.pathname === '/' ? 'active' : ''}
          >
            Dashboard
          </Link>
          <Link
            to="/tools"
            className={location.pathname === '/tools' ? 'active' : ''}
          >
            Tools
            {pendingConfirmations > 0 && (
              <span className="nav-badge">{pendingConfirmations}</span>
            )}
          </Link>
          <Link
            to="/chat"
            className={location.pathname === '/chat' ? 'active' : ''}
          >
            Chat
          </Link>
        </div>
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tools" element={<Tools />} />
          <Route
            path="/chat"
            element={<Chat selectedModel={selectedModel} />}
          />
        </Routes>
      </main>
    </div>
  )
}

export default App