export default function PageHeader({ title, description, icon: Icon, tone = 'mint', children }) {
  return <header className="page-header">
    <div className="page-heading">
      {Icon && <span className={`module-icon ${tone}`}><Icon size={23} aria-hidden="true" /></span>}
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    </div>
    {children && <div className="page-actions">{children}</div>}
  </header>;
}
