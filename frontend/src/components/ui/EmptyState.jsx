export default function EmptyState({ icon: Icon, title, description, children, tone = 'mint' }) {
  return <section className="empty-state">
    {Icon && <span className={`module-icon ${tone}`}><Icon size={25} aria-hidden="true" /></span>}
    <h2>{title}</h2>
    <p>{description}</p>
    {children}
  </section>;
}
