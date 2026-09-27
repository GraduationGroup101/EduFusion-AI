/** Lossless crops of the approved artwork; never recreate its typography in CSS. */
export function BrandMark({ className = "" }) {
  return (
    <img
      src="/brand/edufusion-mark.webp"
      width="564"
      height="466"
      className={`brand-mark ${className}`}
      alt=""
    />
  );
}

export default function Brand({ compact = false, light = false, full = false }) {
  return (
    <span
      className={`brand ${light ? "brand-light" : ""} ${full ? "brand-full" : ""}`}
      role="img"
      aria-label={full ? "EduFusion — All Your Learning, In One Place" : "EduFusion"}
    >
      {full ? (
        <img src="/brand/edufusion-full.webp" width="1000" height="736" alt="" />
      ) : (
        <>
          <BrandMark />
          {!compact && (
            <img className="brand-wordmark" src="/brand/edufusion-wordmark.webp" width="996" height="186" alt="" />
          )}
        </>
      )}
    </span>
  );
}
