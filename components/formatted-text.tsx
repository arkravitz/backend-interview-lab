import { Fragment, isValidElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DesignWhiteboard } from '@/components/design-whiteboard';
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
        .map((part, i) =>
          part.startsWith('`') ? (
            <code key={i}>{part.slice(1, -1)}</code>
          ) : part.startsWith('**') ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}
export function FormattedText({
  text,
  diagrams = false,
}: {
  text: string;
  diagrams?: boolean;
}) {
  return (
    <div className="formatted-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            if (
              diagrams &&
              isValidElement<{ className?: string; children?: unknown }>(
                children,
              ) &&
              children.props.className === 'language-mermaid' &&
              typeof children.props.children === 'string'
            ) {
              return (
                <DesignWhiteboard
                  key={children.props.children}
                  source={children.props.children.trim()}
                />
              );
            }
            return <pre>{children}</pre>;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
