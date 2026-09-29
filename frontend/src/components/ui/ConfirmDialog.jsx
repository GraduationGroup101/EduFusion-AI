import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Small accessible confirmation: focus moves in, Tab stays inside, Escape and
// the backdrop cancel, and focus returns to the opener when it closes.
export default function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', busy = false, onConfirm, onCancel, children }) {
  const panel = useRef(null);
  const cancelButton = useRef(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    cancelButton.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel.current?.(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" className="dialog-panel">
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        {children}
        <div className="dialog-actions">
          <button ref={cancelButton} type="button" onClick={onCancel} disabled={busy} className="button-outline">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="button-danger">{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
