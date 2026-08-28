import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

interface MarkdownAnswerProps {
  source: string;
  streaming?: boolean;
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (!isSafeExternalUrl(href)) return <span>{children}</span>;
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
  img: ({ alt }) => <span className="technical-qa__blocked-image">{alt || '图片'}</span>,
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  h4: ({ children }) => <h6>{children}</h6>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
};

export function MarkdownAnswer({ source, streaming = false }: MarkdownAnswerProps) {
  const renderedSource = useFrameBatchedSource(source, streaming);
  return (
    <MarkdownErrorBoundary source={renderedSource}>
      <div className="technical-qa__answer">
        <ReactMarkdown components={MARKDOWN_COMPONENTS} skipHtml>
          {renderedSource}
        </ReactMarkdown>
        {streaming && <span className="technical-qa__cursor" aria-hidden="true" />}
      </div>
    </MarkdownErrorBoundary>
  );
}

function useFrameBatchedSource(source: string, streaming: boolean): string {
  const [renderedSource, setRenderedSource] = useState(source);

  useEffect(() => {
    if (!streaming) return;
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      const timer = globalThis.setTimeout(() => setRenderedSource(source), 0);
      return () => globalThis.clearTimeout(timer);
    }
    const frame = globalThis.requestAnimationFrame(() => setRenderedSource(source));
    return () => globalThis.cancelAnimationFrame(frame);
  }, [source, streaming]);

  return streaming ? renderedSource : source;
}

function isSafeExternalUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface MarkdownErrorBoundaryProps {
  source: string;
  children: ReactNode;
}

interface MarkdownErrorBoundaryState {
  failed: boolean;
  failedSource: string | null;
}

class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  state: MarkdownErrorBoundaryState = { failed: false, failedSource: null };

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { failed: true, failedSource: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Failed to render technical QA Markdown.', error, info);
    this.setState({ failedSource: this.props.source });
  }

  componentDidUpdate() {
    if (this.state.failed && this.state.failedSource !== null && this.state.failedSource !== this.props.source) {
      this.setState({ failed: false, failedSource: null });
    }
  }

  render() {
    if (this.state.failed) {
      return <p className="technical-qa__answer">{this.props.source}</p>;
    }
    return this.props.children;
  }
}
