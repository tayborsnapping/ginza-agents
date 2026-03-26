import { useState, useEffect, useCallback } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import AgentDetail from './pages/AgentDetail.jsx';
import Alerts from './pages/Alerts.jsx';
import Stats from './pages/Stats.jsx';

const TABS = ['dashboard', 'alerts', 'stats'];
const REFRESH_INTERVAL = 30_000; // 30 seconds

function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

export function apiFetch(path) {
  const token = getToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = token ? `${path}${sep}token=${token}` : path;
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`API ${r.status}: ${r.statusText}`);
    return r.json();
  });
}

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [serverTime, setServerTime] = useState('');

  const refreshTime = useCallback(() => {
    apiFetch('/api/agents').then(d => setServerTime(d.serverTime)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshTime();
    const id = setInterval(refreshTime, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refreshTime]);

  function handleAgentClick(agentId) {
    setSelectedAgent(agentId);
    setTab('agent-detail');
  }

  function handleBack() {
    setSelectedAgent(null);
    setTab('dashboard');
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span>🏯</span> Ginza Mission Control
        </div>
        <div className="header-meta">{serverTime || '...'}</div>
      </header>

      <nav className="nav">
        {TABS.map(t => (
          <button
            key={t}
            className={`nav-btn ${tab === t ? 'active' : ''}`}
            onClick={() => { setTab(t); setSelectedAgent(null); }}
          >
            {t === 'dashboard' ? 'Dashboard' : t === 'alerts' ? 'Alerts' : 'Stats'}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'dashboard' && <Dashboard onAgentClick={handleAgentClick} />}
        {tab === 'agent-detail' && selectedAgent && (
          <AgentDetail agentId={selectedAgent} onBack={handleBack} />
        )}
        {tab === 'alerts' && <Alerts />}
        {tab === 'stats' && <Stats />}
      </main>
    </div>
  );
}
