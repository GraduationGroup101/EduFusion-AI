import { BrandMark } from '../Brand';

/**
 * One branded loading state for places where a whole view is loading: the
 * session check, the first app chunk, and page transitions inside the
 * workspace. It uses the approved EduFusion mark and a quiet three-dot
 * pulse; with reduced motion the dots stay still. Small contextual spinners
 * elsewhere are intentionally not replaced by this.
 *
 * variant "screen" fills the viewport (outside the workspace shell);
 * variant "panel" sits inside the current content area.
 */
export default function BrandedLoader({ label = 'Loading', variant = 'panel', className = '' }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className={`branded-loader branded-loader--${variant} ${className}`.trim()}>
      <BrandMark className="branded-loader__mark" />
      <span className="branded-loader__dots" aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className="branded-loader__label">{label}</span>
    </div>
  );
}
