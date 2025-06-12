'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Source } from '@/features/search/lib/langgraph-search-engine';
import { getFaviconUrl, getDefaultFavicon, markFaviconFailed } from '@/lib/favicon-utils';

interface CitationTooltipProps {
  sources: Source[];
}

export function CitationTooltip({ sources }: CitationTooltipProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; source: Source } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.classList.contains('citation')) {
        const citationText = target.textContent?.match(/\d+/)?.[0];
        if (citationText) {
          const index = parseInt(citationText) - 1;
          const source = sources[index];
          if (source) {
            const rect = target.getBoundingClientRect();
            setTooltip({
              x: rect.left + rect.width / 2,
              y: rect.top,
              source
            });
          }
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.classList.contains('citation')) {
        timeoutRef.current = setTimeout(() => {
          setTooltip(null);
        }, 200);
      }
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [sources]);

  if (!tooltip) return null;

  const maxUrlLength = 50;
  const displayUrl = tooltip.source.url.length > maxUrlLength
    ? tooltip.source.url.substring(0, maxUrlLength) + '...'
    : tooltip.source.url;

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: tooltip.x,
        top: tooltip.y - 8,
        transform: 'translate(-50%, -100%)'
      }}
      onMouseEnter={() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }}
      onMouseLeave={() => setTooltip(null)}
    >
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 max-w-sm pointer-events-auto">
        <div className="flex items-start gap-3">
          <Image
            src={getFaviconUrl(tooltip.source.url)}
            alt=""
            width={20}
            height={20}
            className="w-5 h-5 mt-0.5 flex-shrink-0 rounded-sm"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.src = getDefaultFavicon(20);
              markFaviconFailed(tooltip.source.url);
            }}
          />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-tight mb-1">
              {tooltip.source.title}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-all">
              {new URL(tooltip.source.url).hostname}
            </p>
            {tooltip.source.summary && (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3 leading-relaxed">
                {tooltip.source.summary}
              </p>
            )}
          </div>
        </div>
      </div>
      {/* Enhanced Arrow */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-2">
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-white dark:border-t-gray-800" />
        <div className="absolute left-1/2 -translate-x-1/2 -top-0.5">
          <div className="w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[7px] border-t-gray-200 dark:border-t-gray-700" />
        </div>
      </div>
    </div>
  );
}