'use client';

import { useState, type ReactNode } from 'react';
import type { TopicImportantQuestionDTO } from '@/lib/api/client';
import { cn } from '@/components/ui/cn';
import { BookOpenIcon, ChevronDownIcon } from '@/components/ui/icons';

export interface AIExplanationCardProps {
  title: string;
  explanationMarkdown: string | null;
  importantQuestions: readonly TopicImportantQuestionDTO[];
  contentVersion?: number;
  requiredDepth?: string;
  className?: string;
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? '').trim();
      if (
        !cur ||
        cur.startsWith('```') ||
        /^#{1,3}\s+/.test(cur) ||
        /^[-*+]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur)
      ) {
        break;
      }
      paragraphLines.push(cur);
      i += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
    }
  }

  return blocks;
}

/**
 * Safely renders inline `code` and **bold** spans without raw HTML injection.
 */
function renderInlineText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`code-${tokenIdx}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.875em] text-slate-900 dark:bg-slate-800 dark:text-slate-100"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong
          key={`bold-${tokenIdx}`}
          className="font-semibold text-slate-900 dark:text-slate-100"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    }
    tokenIdx += 1;
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function MarkdownContent({ markdown }: { markdown: string }) {
  const blocks = parseMarkdownBlocks(markdown);

  return (
    <div className="flex flex-col gap-3.5 text-body-md leading-relaxed text-slate-700 dark:text-slate-300">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h3
                key={idx}
                dir="auto"
                className="text-heading-md font-semibold text-slate-900 dark:text-slate-100"
              >
                {renderInlineText(block.text)}
              </h3>
            );
          }
          return (
            <h4
              key={idx}
              dir="auto"
              className="text-body-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {renderInlineText(block.text)}
            </h4>
          );
        }

        if (block.type === 'code') {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-slate-100 dark:border-slate-700"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={idx}
              className={cn(
                'flex flex-col gap-1.5 pl-5',
                block.ordered ? 'list-decimal' : 'list-disc',
              )}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} dir="auto">
                  {renderInlineText(item)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={idx} dir="auto">
            {renderInlineText(block.text)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Component 25 `AIExplanationCard` (`topic_explanation` variant, `C09` §2.7 / `PRD` §28, §47):
 * Renders mixed Bangla-English Markdown topic study guidance safely without raw HTML injection,
 * plus collapsible self-check Q&A (`important_questions`). Never displays internal provider/model info.
 */
export function AIExplanationCard({
  title,
  explanationMarkdown,
  importantQuestions,
  contentVersion,
  requiredDepth,
  className,
}: AIExplanationCardProps) {
  const [expandedIndices, setExpandedIndices] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const toggleQuestion = (index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <section
      aria-label="Topic study explanation"
      className={cn(
        'flex flex-col gap-6 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
            <BookOpenIcon className="block h-4 w-4 shrink-0" />
          </span>
          <div className="min-w-0">
            <h2
              className="truncate text-heading-md font-semibold text-slate-900 dark:text-slate-100"
              dir="auto"
            >
              {title}
            </h2>
            <p className="text-caption text-slate-500 dark:text-slate-400">
              Guided concept overview &amp; key takeaways
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {requiredDepth && (
            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium capitalize leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Depth: {requiredDepth}
            </span>
          )}
          {typeof contentVersion === 'number' && contentVersion >= 1 && (
            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-medium leading-none tabular-nums text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              v{contentVersion}
            </span>
          )}
        </div>
      </div>

      {explanationMarkdown?.trim() ? (
        <MarkdownContent markdown={explanationMarkdown} />
      ) : (
        <p className="text-body-sm text-slate-500 dark:text-slate-400">
          Study notes for this topic are being prepared.
        </p>
      )}

      {importantQuestions.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          <div>
            <h3 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
              Key Questions to Check Your Understanding
            </h3>
            <p className="mt-0.5 text-caption text-slate-500 dark:text-slate-400">
              Try answering each question before revealing the reference explanation.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            {importantQuestions.map((qa, index) => {
              const expanded = expandedIndices.has(index);
              const panelId = `topic-qa-panel-${index}`;
              return (
                <div
                  key={`${index}-${qa.question.slice(0, 32)}`}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggleQuestion(index)}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-body-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100/80 dark:text-slate-100 dark:hover:bg-slate-800/60"
                  >
                    <span className="min-w-0 flex-1" dir="auto">
                      {index + 1}. {qa.question}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        'block h-4 w-4 shrink-0 text-slate-500 transition-transform duration-(--duration-fast)',
                        expanded && 'rotate-180',
                      )}
                    />
                  </button>
                  {expanded && (
                    <div
                      id={panelId}
                      className="border-t border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <MarkdownContent markdown={qa.answer_markdown} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
