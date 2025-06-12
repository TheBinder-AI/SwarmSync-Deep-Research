'use client';

import { SearchEvent, SearchPhase, Source } from '@/lib/langgraph-search-engine';
import { useState, useEffect } from 'react';
import { MarkdownRenderer } from './markdown-renderer';
import { CitationTooltip } from './citation-tooltip';
import { getFaviconUrl, getDefaultFavicon, markFaviconFailed } from '@/lib/favicon-utils';
import Image from 'next/image';

// Simplified thinking indicator
function ThinkingIndicator({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm py-1">
      <div className="flex gap-1">
        <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
        <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
        <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
      </div>
      <span className="text-xs">{message}</span>
    </div>
  );
}

// Clean source processing indicator
function SourceProcessing({ url, stage }: {
  url: string;
  stage: 'browsing' | 'extracting' | 'analyzing' | 'complete';
}) {
  const stageIcons = {
    browsing: '🌐',
    extracting: '📄',
    analyzing: '🔍',
    complete: '✅'
  };

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 py-1">
      <span>{stageIcons[stage]}</span>
      <span className="truncate">{new URL(url).hostname}</span>
    </div>
  );
}

// Enhanced typing effect hook
function useTypingEffect(text: string, speed: number = 8) {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    setDisplayedText('');

    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  return { displayedText, isTyping };
}

function renderEvent(event: SearchEvent) {
  switch (event.type) {
    case 'phase-update':
      const phaseMessages: Record<SearchPhase, string> = {
        understanding: "Understanding your question...",
        planning: "Planning research strategy...",
        searching: "Searching for information...",
        analyzing: "Analyzing sources...",
        synthesizing: "Synthesizing answer...",
        complete: "Complete",
        error: "Error occurred"
      };
      return <ThinkingIndicator message={phaseMessages[event.phase] || event.message} />;

    case 'thinking':
      return <ThinkingIndicator message={event.message} />;

    case 'found':
      return <ThinkingIndicator message={`Found ${event.sources.length} relevant sources`} />;

    case 'scraping':
      return <ThinkingIndicator message={`Reading ${new URL(event.url).hostname}...`} />;

    case 'source-processing':
      return <SourceProcessing url={event.url} stage={event.stage} />;

    case 'source-complete':
      return <SourceProcessing url={event.url} stage="complete" />;

    default:
      return null;
  }
}

interface SearchDisplayProps {
  events: SearchEvent[];
  sources: Source[];
  onFollowUpQuestion?: (question: string) => void;
}

export function SearchDisplay({ events, sources, onFollowUpQuestion }: SearchDisplayProps) {
  const [currentPhase, setCurrentPhase] = useState<SearchPhase | null>(null);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);

  // Track current phase from phase-update events
  useEffect(() => {
    const lastPhaseEvent = events.filter(e => e.type === 'phase-update').pop();
    if (lastPhaseEvent && lastPhaseEvent.type === 'phase-update') {
      setCurrentPhase(lastPhaseEvent.phase);
    }
  }, [events]);

  const finalResultEvent = events.find(e => e.type === 'final-result');
  const isComplete = currentPhase === 'complete' || !!finalResultEvent;

  // Enhanced typing effect for the final answer
  const { displayedText: typedAnswer, isTyping } = useTypingEffect(
    isComplete ? finalResultEvent?.content || '' : '',
    6 // Very fast typing
  );

  const showSources = isComplete && sources.length > 0;

  return (
    <div className="w-full space-y-4">
      {/* Citation Tooltip */}
      <CitationTooltip sources={sources} />

      {/* Clean Progress Indicator - Only show when actively searching */}
      {!isComplete && events.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border-l-4 border-purple-500">
          <div className="space-y-1">
            {events.slice(-3).map((event, index) => (
              <div key={index}>
                {renderEvent(event)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Answer - Perplexity/Grok Style */}
      {isComplete && finalResultEvent && finalResultEvent.type === 'final-result' && (
        <div className="space-y-4">
          {/* Clean Answer Display */}
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <div
              className="text-gray-900 dark:text-gray-100 leading-relaxed"
              style={{ fontSize: '14px', lineHeight: '1.6' }}
            >
              <MarkdownRenderer content={isTyping ? typedAnswer : finalResultEvent.content} />
              {isTyping && (
                <span className="inline-block w-0.5 h-4 bg-purple-500 animate-pulse ml-1 align-text-bottom"></span>
              )}
            </div>
          </div>

          {/* Source Navigation - Compact and Clean */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Sources:</span>
              {sources.map((source, i) => (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
                  title={source.title}
                >
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 text-white text-xs font-bold flex items-center justify-center shadow-sm ring-2 ring-purple-100 dark:ring-purple-900/50">
                    {i + 1}
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{new URL(source.url).hostname}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Follow-up questions - Clean Design */}
      {isComplete && finalResultEvent?.type === 'final-result' && finalResultEvent.followUpQuestions && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Follow Up</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {finalResultEvent.followUpQuestions.slice(0, 4).map((question, index) => (
              <button
                key={index}
                onClick={() => onFollowUpQuestion?.(question)}
                className="text-left w-full p-3 text-sm text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vertical Source Cards - Only show if there are sources */}
      {showSources && sources.length > 0 && (
        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            Source Details
          </h3>
          <div className="space-y-3">
            {sources.map((source, i) => (
              <CitationCard key={i} source={source} index={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Clean Citation Card Component - Perplexity Style
function CitationCard({ source, index }: { source: Source; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors bg-white dark:bg-gray-800/50">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 text-white text-sm font-bold flex items-center justify-center shadow-md ring-2 ring-purple-100 dark:ring-purple-900/50">
              {index}
            </span>
            <Image
              src={getFaviconUrl(source.url)}
              alt=""
              width={18}
              height={18}
              className="w-4.5 h-4.5 rounded-sm"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.src = getDefaultFavicon(18);
                markFaviconFailed(source.url);
              }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm text-gray-900 dark:text-gray-100 hover:text-purple-600 dark:hover:text-purple-400 line-clamp-2 transition-colors leading-tight"
                >
                  {source.title}
                </a>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1.5">
                  {new URL(source.url).hostname}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {source.summary && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={isExpanded ? "Hide summary" : "Show summary"}
                  >
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Open source"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>

            {isExpanded && source.summary && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {source.summary}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}