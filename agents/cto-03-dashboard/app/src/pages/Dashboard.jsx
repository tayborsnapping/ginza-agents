import { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

function timeAgo(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }) {
  const s = status || 'none';
  return (
    <span className={`badge badge-${s}`}>
      <span className="badge-dot" />
      {s}
    </span>
  );
}

export default function Dashboard({ onAgentClick }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    function load() {
      apiFetch('/api/agents')
        .then(d => { if (mounted) { setAgents(d.agents); setLoading(false); } })
        .catch(e => { if (mounted) { setError(e.message); setLoading(false); } });
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (loading) return <div className="loading">Loading agents...</div>;
  if (error) return <div className="error-msg">Error: {error}</div>;

  // Group by department
  const departments = {};
  for (const agent of agents) {
    const dept = agent.department || 'Other';
    if (!departments[dept]) departments[dept] = [];
    departments[dept].push(agent);
  }

  // Summary counts
  const total = agents.length;
  const successes = agents.filter(a => a.lastRun?.status === 'success').length;
  const failures = agents.filter(a => a.lastRun?.status === 'failure').length;
  const idle = agents.filter(a => !a.lastRun).length;

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Total Agents</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--green)' }}>{successes}</div>
          <div className="stat-label">Healthy</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--red)' }}>{failures}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{idle}</div>
          <div className="stat-label">No Runs</div>
        </div>
      </div>

      {Object.entries(departments).map(([dept, deptAgents]) => (
        <div key={dept} style={{ marginBottom: 24 }}>
          <div className="section-title">{dept} Department</div>
          <div className="agent-grid">
            {deptAgents.map(agent => (
              <div
                key={agent.id}
                className="agent-card"
                onClick={() => onAgentClick(agent.id)}
              >
                <div className="agent-card-header">
                  <div>
                    <div className="agent-name">{agent.name}</div>
                    <div className="agent-id">{agent.id}</div>
                  </div>
                  <StatusBadge status={agent.lastRun?.status} />
                </div>
                <div className="agent-meta">
                  <div className="agent-meta-row">
                    <span>Schedule</span>
                    <span>{agent.schedule}</span>
                  </div>
                  <div className="agent-meta-row">
                    <span>Last Run</span>
                    <span>{timeAgo(agent.lastRun?.completed_at || agent.lastRun?.started_at)}</span>
                  </div>
                  <div className="agent-meta-row">
                    <span>Duration</span>
                    <span>{formatDuration(agent.lastRun?.duration_ms)}</span>
                  </div>
                  <div className="agent-meta-row">
                    <span>Total Runs</span>
                    <span>{agent.totalRuns}</span>
                  </div>
                  {agent.recentFailures > 0 && (
                    <div className="agent-meta-row">
                      <span style={{ color: 'var(--red)' }}>Failures (7d)</span>
                      <span style={{ color: 'var(--red)' }}>{agent.recentFailures}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
