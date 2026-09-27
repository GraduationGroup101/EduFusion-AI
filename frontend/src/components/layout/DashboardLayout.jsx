import { useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Menu, ChevronRight, ShieldCheck } from "lucide-react";
import Sidebar from "./Sidebar";
import Brand from "../Brand";
import { useAuth } from "../../context/AuthContext";

const titles = {
  "/dashboard": "Overview",
  "/dashboard/chatbot": "Academic Chatbot",
  "/dashboard/my-prediction": "EduPredict",
  "/dashboard/ai-tool": "EduPredict",
  "/dashboard/question-gen": "Quiz Generator",
  "/dashboard/youtube": "LectureScribe",
  "/dashboard/admin/at-risk": "At-Risk Students",
  "/dashboard/admin/clock": "Academic Clock",
  "/dashboard/admin/chatbot-files": "Chatbot Administration",
};
export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef(null);
  const { pathname } = useLocation();
  const { user } = useAuth();
  return (
    <div className="workspace-shell flex h-dvh bg-primary">
      <a href="#workspace-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        menuRef={menuRef}
      />
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-light-accent/25 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={mobileNavOpen ? '' : undefined}>
        <header className="workspace-header">
          <button
            type="button"
            ref={menuRef}
            onClick={() => setMobileNavOpen(true)}
            className="p-2 md:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            aria-controls="workspace-navigation"
          >
            <Menu size={21} />
          </button>
          <div className="md:hidden">
            <Brand compact />
          </div>
          <nav aria-label="Breadcrumb" className="workspace-breadcrumb hidden min-w-0 items-center gap-3 text-sm md:flex">
            <Link to="/dashboard" className="text-light-accent/60">
              Workspace
            </Link>
            <ChevronRight size={14} className="text-light-accent/35" />
            <span className="truncate" aria-current="page">{titles[pathname] || "Overview"}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-secondary">
            <ShieldCheck size={16} />
            <span className="capitalize">
              {user?.role === "student"
                ? "My learning space"
                : `${user?.role || "Staff"} workspace`}
            </span>
          </div>
        </header>
        <main
          id="workspace-content"
          className="workspace-content min-h-0 min-w-0 flex-1 overflow-y-auto"
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
