import React from 'react';

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Renderer crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel">
          <div className="error-card">
            <h1>Something went wrong</h1>
            <p className="muted">{this.state.error.message || String(this.state.error)}</p>
            {/* Retry remounts just this boundary's subtree; Reload is the big hammer. */}
            <button className="primary" onClick={() => this.setState({ error: null })}>Try again</button>{' '}
            <button onClick={() => location.reload()}>Reload app</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
