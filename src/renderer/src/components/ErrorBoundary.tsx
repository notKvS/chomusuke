import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

/**
 * Catches an error that breaks the app's screen (a component that throws while drawing, or in an effect's clean-up),
 * which would otherwise leave an empty window. It reports the error to the main process, which tells the user what
 * happened, offers to share the log with the developer, and restarts the app. Until then it shows a short note.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const details = `${error.stack ?? String(error)}\n\nComponent stack:${info.componentStack ?? ''}`
    try {
      void window.chomusuke.reportCrash(details).catch(() => {})
    } catch {
      // Without the bridge there is nobody to tell; the note below is all there is.
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="crashed" role="alert">
        <h1>Chomusuke ran into a problem</h1>
        <p>A window will ask what to do next.</p>
      </div>
    )
  }
}
