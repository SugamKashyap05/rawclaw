import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

const App: React.FC = () => {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    invoke<string>('get_version').then(setVersion).catch(console.error)
  }, [])

  const handleNotification = async () => {
    try {
      await invoke('show_notification', { title: 'RawClaw', body: 'Test notification!' })
    } catch (e) {
      console.error('Notification error:', e)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#1a1a1a',
          borderBottom: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>RawClaw</span>
          <span style={{ fontSize: '12px', color: '#888' }}>v{version}</span>
        </div>
        <button
          onClick={handleNotification}
          style={{
            background: 'transparent',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '4px 12px',
            cursor: 'pointer',
            color: '#fff',
            fontSize: '12px',
          }}
        >
          🔔 Test Notification
        </button>
      </div>
      <iframe
        src="http://localhost:5173"
        style={{ flex: 1, border: 'none', backgroundColor: '#fff' }}
        title="RawClaw Web App"
      />
    </div>
  )
}

export default App