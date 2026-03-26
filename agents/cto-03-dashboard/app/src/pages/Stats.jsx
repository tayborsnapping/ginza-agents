import { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    apiFetch('/api/stats')
      .then(d => { if (mounted) { setStats(d); setLoading(false); } })
      .catch(e => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="loading">Loading stats...</div>;
  if (error) return <div className="error-msg">Error: {error}</div>;
  if (!stats) return null;

  const runStatuses = stats.runs?.byStatus || {};
  const totalRuns = Object.values(runStatuses).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="section-title">System Statistics</div>

      {/* Overview cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalRuns}</div>
          <div className="stat-label">Total Runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--green)' }}>{runStatuses.success || 0}</div>
          <div className="stat-label">Successes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--red)' }}>{runStatuses.failure || 0}</div>
          <div className="stat-label">Failures</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            ${stats.cost?.allTime?.toFixed(2) || '0.00'}
          </div>
          <div className="stat-label">Est. Total Cost</div>
        </div>
      </div>

      {/* Token usage */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">All-Time Tokens</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {formatNumber(stats.tokens?.allTime?.input)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Input tokens</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {formatNumber(stats.tokens?.allTime?.output)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Output tokens</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Last 7 Days</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)' }}>
              ${stats.cost?.last7Days?.toFixed(2) || '0.00'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {formatNumber(stats.tokens?.last7Days?.input)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Input tokens</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {formatNumber(stats.tokens?.last7Days?.output)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Output tokens</div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-agent breakdown */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Per-Agent Performance</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Runs</th>
                <th>Success</th>
                <th>Failure</th>
                <th>Avg Duration</th>
                <th>Tokens (In/Out)</th>
              </tr>
            </thead>
            <tbody>
              {(stats.runs?.perAgent || []).map(agent => (
                <tr key={agent.agent_id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{agent.agent_id}</td>
                  <td>{agent.count}</td>
                  <td style={{ color: 'var(--green)' }}>{agent.successes}</td>
                  <td style={{ color: agent.failures > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                    {agent.failures}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {agent.avgDuration ? `${(agent.avgDuration / 1000).toFixed(1)}s` : '-'}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {formatNumber(agent.tokensIn)} / {formatNumber(agent.tokensOut)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily activity */}
      {stats.runs?.daily?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Daily Activity (14 days)</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total Runs</th>
                  <th>Successes</th>
                  <th>Failures</th>
                </tr>
              </thead>
              <tbody>
                {stats.runs.daily.map(day => (
                  <tr key={day.date}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{day.date}</td>
                    <td>{day.count}</td>
                    <td style={{ color: 'var(--green)' }}>{day.successes}</td>
                    <td style={{ color: day.failures > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                      {day.failures}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        {stats.cost?.note}
      </div>
    </div>
  );
}
