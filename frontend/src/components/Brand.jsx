/** Transparent crops of the approved artwork; never recreate its typography in CSS. */
export function BrandMark({ className = "" }) {
  return (
    <img
      src="/brand/edufusion-mark-alpha.png"
      width="546"
      height="454"
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
        <img src="/brand/edufusion-full-alpha.png" width="973" height="716" alt="" />
      ) : (
        <>
          <BrandMark />
          {!compact && (
            <img className="brand-wordmark" src="/brand/edufusion-wordmark-alpha.png" width="973" height="173" alt="" />
          )}
        </>
      )}
    </span>
  );
}
