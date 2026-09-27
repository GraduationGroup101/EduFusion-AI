/** The approved artwork is displayed directly, without redrawing the mark. */
export function BrandMark({ className = "" }) {
  return (
    <svg
      viewBox="440 160 580 470"
      className={`brand-mark ${className}`}
      aria-hidden="true"
    >
      <image href="/brand/edufusion-logo.png" width="1448" height="1086" />
    </svg>
  );
}

export default function Brand({ compact = false, light = false }) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <BrandMark />
      {!compact && (
        <span className="brand-name">
          Edu<span>Fusion</span>
          <small>ALL YOUR LEARNING, IN ONE PLACE</small>
        </span>
      )}
    </span>
  );
}
