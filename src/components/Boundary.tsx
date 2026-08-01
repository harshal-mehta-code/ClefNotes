import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last line of defence.
 *
 * A React render error unmounts the whole tree, and a static site has no server
 * log to tell anyone why — so an app that only ever ships to a browser has to
 * catch its own crashes or it will one day show a white page and nothing else.
 * That is exactly what happened: scores saved by an older version of ClefNotes
 * had no page data, the shelf read their page count, and the app disappeared.
 *
 * The escape hatch matters as much as the message. Anything that survives on
 * the device — a stored score, a cached build, a service worker — can keep
 * breaking every reload, and there is no support desk to clear it.
 */
interface State {
  error: Error | null;
}

export default class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ClefNotes crashed:', error, info.componentStack);
  }

  private reset = async () => {
    try {
      indexedDB.deleteDatabase('clefnotes');
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      /* whatever is left, reloading is still worth a try */
    }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-[560px] px-5 py-14">
        <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-[-0.03em]">
          ClefNotes stopped.
        </h1>
        <p className="mt-3 text-[15px] leading-snug text-ink2">
          Something went wrong while drawing the page. Reloading usually fixes it. If it keeps
          happening, clearing this device's saved scores will — you will need to import your PDFs
          again, and nothing leaves the device either way.
        </p>
        <pre className="mt-4 overflow-x-auto border border-rule2 bg-panel p-3 font-mono text-[11.5px] text-ink2">
          {this.state.error.message}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => void this.reset()}>
            Clear saved scores and reload
          </button>
        </div>
      </div>
    );
  }
}
