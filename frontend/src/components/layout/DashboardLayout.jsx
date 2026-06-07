import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Brain, Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-primary overflow-hidden">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-light-accent/25 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="h-14 flex-shrink-0 border-b border-border bg-white px-4 flex items-center justify-between md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="w-10 h-10 inline-flex items-center justify-center text-light-accent"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-secondary text-white inline-flex items-center justify-center">
              <Brain className="w-4 h-4" />
            </span>
            <span className="font-display text-sm font-bold text-light-accent">EduPredict</span>
          </div>
          <span className="w-10" aria-hidden="true" />
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
