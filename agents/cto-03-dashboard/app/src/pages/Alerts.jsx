import { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

const PRIORITIES = ['all', 'critical', 'warning', 'info'];

function formatTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit' });
  } catch {
    return iso;
  }
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const params = filter === 'all' ? '?limit=100' : `?priority=${filter}&limit=100`;
    apiFetch(`/api/alerts${params}`)
      .then(d => { if (mounted) { setAlerts(d.alerts); setLoading(false); } })
      .catch(e => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; };
  }, [filter]);

  if (error) return <div className="error-msg">Error: {error}</div>;

  return (
    <div>
      <div className="section-title">Alerts</div>

      <div className="filters">
        {PRIORITIES.map(p => (
          <button
            key={p}
            className={`filter-btn ${filter === p ? 'active' : ''}`}
            onClick={() => setFilter(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">Loading alerts...</div>
        ) : alerts.length === 0 ? (
          <div className="loading">No alerts found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Source</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Sent</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => (
                  <tr key={alert.id}>
                    <td>
                      <span className={`badge badge-${alert.priority}`}>
                        {alert.priority}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {alert.source_agent}
                    </td>
                    <td style={{ fontWeight: 500 }}>{alert.title}</td>
                    <td style={{ fontSize: 12, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alert.message}
                    </td>
                    <td>
                      {alert.sent
                        ? <span style={{ color: 'var(--green)' }}>Yes</span>
                        : <span style={{ color: 'var(--yellow)' }}>Pending</span>}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                      {formatTime(alert.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
