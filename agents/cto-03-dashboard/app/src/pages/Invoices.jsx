import { useState, useEffect } from 'react';
import { apiFetch } from '../App.jsx';

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  described: 'Described',
  in_shopify: 'In Shopify',
  approved: 'Approved',
  needs_review: 'Needs Review',
  parsed: 'Parsed',
};

const STATUS_BADGE = {
  confirmed: 'badge-success',
  described: 'badge-info',
  in_shopify: 'badge-info',
  approved: 'badge-warning',
  needs_review: 'badge-warning',
  parsed: 'badge-failure',
};

function formatCurrency(val, currency) {
  if (val == null) return '-';
  const sym = currency === 'JPY' ? '¥' : '$';
  return `${sym}${Number(val).toFixed(currency === 'JPY' ? 0 : 2)}`;
}

function formatTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit' });
  } catch {
    return iso;
  }
}

export default function Invoices() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    apiFetch('/api/invoices')
      .then(d => { if (mounted) { setData(d); setLoading(false); } })
      .catch(e => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  if (error) return <div className="error-msg">Error: {error}</div>;
  if (loading) return <div className="loading">Loading invoices...</div>;

  const { invoices, summary, csvAvailable, timestamps } = data;

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const csvUrl = token ? `${BASE}/api/invoices/csv?token=${token}` : `${BASE}/api/invoices/csv`;

  return (
    <div>
      <div className="section-title">Invoice Pipeline</div>

      {/* Summary cards */}
      <div className="stat-cards" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-value">{summary.total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid var(--green)' }}>
          <div className="stat-value">{summary.confirmed}</div>
          <div className="stat-label">Confirmed</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid var(--blue, #3b82f6)' }}>
          <div className="stat-value">{(summary.described || 0) + (summary.inShopify || 0)}</div>
          <div className="stat-label">In Shopify</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid var(--yellow)' }}>
          <div className="stat-value">{summary.needsReview + (summary.approved || 0)}</div>
          <div className="stat-label">Pending</div>
        </div>
      </div>

      {/* CSV download */}
      {csvAvailable && (
        <div style={{ marginBottom: 16 }}>
          <a
            href={csvUrl}
            className="filter-btn active"
            style={{ textDecoration: 'none', display: 'inline-block' }}
            download
          >
            Download Shopify CSV
          </a>
        </div>
      )}

      {/* Invoice table */}
      <div className="card">
        {invoices.length === 0 ? (
          <div className="loading">No invoices found. Run the COO pipeline to see data here.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Invoice #</th>
                  <th>Products</th>
                  <th>Total Cost</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={`${inv.supplier}-${inv.invoiceNumber}-${i}`}>
                    <td style={{ fontWeight: 500 }}>{inv.supplier}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {inv.invoiceNumber}
                    </td>
                    <td>{inv.productCount}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(inv.totalCost, inv.currency)}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[inv.pipelineStatus] || 'badge-failure'}`}>
                        {STATUS_LABELS[inv.pipelineStatus] || inv.pipelineStatus}
                      </span>
                    </td>
                    <td>
                      {inv.confidence != null
                        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {Math.round(inv.confidence * 100)}%
                          </span>
                        : '-'}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                      {inv.invoiceDate || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="card" style={{ marginTop: 16, padding: 12, fontSize: 12, color: 'var(--text-dim)' }}>
        <strong>Pipeline timestamps:</strong>{' '}
        Parsed: {formatTime(timestamps.parsed)} |{' '}
        Enriched: {formatTime(timestamps.enriched)} |{' '}
        Shopify: {formatTime(timestamps.shopify)} |{' '}
        Descriptions: {formatTime(timestamps.descriptions)} |{' '}
        Confirmed: {formatTime(timestamps.confirmed)}
      </div>
    </div>
  );
}
