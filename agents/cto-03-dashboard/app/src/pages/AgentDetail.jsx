import { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

const OUTPUT_KEYS = {
  'cto-01-health': 'health_status',
  'cfo-01-weekly': 'weekly_snapshot',
  'cfo-03-margin': 'margin_alerts',
  'coo-01-invoice': 'parsed_invoices',
  'coo-02-shopify': 'shopify_entries',
  'coo-03-descriptions': 'product_descriptions',
};

function formatTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit' });
  } catch {
    return iso;
  }
}

export default function AgentDetail({ agentId, onBack }) {
  const [runs, setRuns] = useState([]);
  const [output, setOutput] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/runs?agent=${agentId}&page=${page}&limit=15`),
      OUTPUT_KEYS[agentId]
        ? apiFetch(`/api/outputs/${OUTPUT_KEYS[agentId]}`)
        : Promise.resolve(null),
    ]).then(([runsData, outputData]) => {
      setRuns(runsData.runs);
      setPagination(runsData.pagination);
      setOutput(outputData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [agentId, page]);

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Back to Dashboard</button>

      <div className="section-title" style={{ marginBottom: 8 }}>{agentId}</div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
        Output key: <code style={{ fontFamily: 'var(--font-mono)' }}>{OUTPUT_KEYS[agentId] || 'none'}</code>
      </p>

      {/* Latest Output */}
      {output && output.data && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Latest Output</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {formatTime(output.createdAt)}
            </span>
          </div>
          <div className="json-block">{JSON.stringify(output.data, null, 2)}</div>
        </div>
      )}

      {/* Run History */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Run History</span>
          {pagination && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {pagination.total} total runs
            </span>
          )}
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="loading">No runs recorded for this agent.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Tokens</th>
                    <th>Summary / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{run.id}</td>
                      <td>
                        <span className={`badge badge-${run.status}`}>
                          <span className="badge-dot" />{run.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                        {formatTime(run.started_at)}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {run.tokens_in || run.tokens_out
                          ? `${(run.tokens_in || 0).toLocaleString()} / ${(run.tokens_out || 0).toLocaleString()}`
                          : '-'}
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {run.error
                          ? <span style={{ color: 'var(--red)' }}>{run.error}</span>
                          : run.summary || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span>{page} / {pagination.totalPages}</span>
                <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
