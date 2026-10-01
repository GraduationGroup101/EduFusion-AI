import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// One failing page must not blank the whole workspace: the shell (sidebar,
// header) stays usable and the student can retry or move to another tool.
// Callers key it by route so navigating away clears the error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page failed to render', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-12 max-w-lg rounded-2xl border border-border bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-light-accent">This page could not be displayed</h2>
        <p className="mt-2 text-sm leading-relaxed text-light-accent/60">
          Something unexpected came back from the server. Your other tools still work, and your saved data is safe.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => this.setState({ error: null })}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-semibold text-white">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
          <a href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm text-light-accent/80">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }
}
