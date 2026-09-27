const tones = {
  high: 'danger', offline: 'danger', unavailable: 'danger', error: 'danger',
  medium: 'warning', warning: 'warning', checking: 'neutral',
  low: 'success', online: 'success', success: 'success', live: 'success',
};

export default function StatusBadge({ status, children }) {
  const key = String(status || '').toLowerCase();
  return <span className={`status-badge status-${tones[key] || 'neutral'}`}>
    <span className="status-dot" aria-hidden="true" />
    {children || (key ? key[0].toUpperCase() + key.slice(1) : 'Unknown')}
  </span>;
}
