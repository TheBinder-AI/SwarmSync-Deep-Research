'use client';

import { memo } from 'react';

interface MarkdownRendererProps {
  content: string;
  streaming?: boolean;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false
}: MarkdownRendererProps) {
  // Enhanced markdown parsing with academic paper support
  const parseMarkdown = (text: string) => {
    // Handle links [text](url) - must come before citations
    let parsed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-orange-600 hover:text-orange-700 underline">$1</a>');

    // Handle citations [1], [2], etc. - Enhanced circular styling with purple gradient
    parsed = parsed.replace(/\[(\d+)\]/g, '<span class="citation inline-flex items-center justify-center w-5 h-5 mx-1 text-xs font-bold text-white bg-gradient-to-br from-purple-500 to-violet-600 rounded-full shadow-sm ring-1 ring-purple-100 dark:ring-purple-900/50 cursor-pointer hover:from-purple-600 hover:to-violet-700 transition-all duration-200 hover:scale-110 align-middle" style="vertical-align: middle;">$1</span>');

    // Enhanced table parsing for research data
    parsed = parseMarkdownTables(parsed);

    // Enhanced code blocks with syntax highlighting classes
    parsed = parsed.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'text';
      return `<div class="code-block-wrapper my-4 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div class="code-header bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span class="text-xs font-mono text-gray-600 dark:text-gray-400 uppercase tracking-wider">${language}</span>
          <button onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.textContent)" class="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">Copy</button>
        </div>
        <pre class="bg-gray-50 dark:bg-gray-900 p-4 overflow-x-auto text-sm leading-relaxed"><code class="language-${language}">${code.trim()}</code></pre>
      </div>`;
    });

    // Research paper sections with enhanced styling
    parsed = parseAcademicSections(parsed);

    // Bold text
    parsed = parsed.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');

    // Italic text  
    parsed = parsed.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headers (process in order from most specific to least) with academic styling
    parsed = parsed.replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold mt-4 mb-2 text-purple-700 dark:text-purple-300 border-b border-purple-200 dark:border-purple-800 pb-1">$1</h4>');
    parsed = parsed.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-5 mb-3 text-purple-800 dark:text-purple-200">$1</h3>');
    parsed = parsed.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-6 mb-3 text-purple-900 dark:text-purple-100">$1</h2>');
    parsed = parsed.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-8 mb-4 text-gray-900 dark:text-gray-100">$1</h1>');

    // Enhanced lists with better academic formatting
    parsed = parseEnhancedLists(parsed);

    // Inline code with better academic styling
    parsed = parsed.replace(/`(.+?)`/g, '<code class="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded text-sm font-mono border border-purple-200 dark:border-purple-800">$1</code>');

    // Key-value pairs for structured research data
    parsed = parseKeyValuePairs(parsed);

    // Paragraphs
    parsed = parsed.split('\n\n').map(para => {
      if (para.trim() && !para.includes('<h') && !para.includes('<ul') && !para.includes('<table') && !para.includes('<div class="code-block-wrapper')) {
        return `<p class="mb-4 leading-relaxed">${para}</p>`;
      }
      return para;
    }).join('\n');

    // Clean up
    parsed = parsed.replace(/<p class="mb-4 leading-relaxed"><\/p>/g, '');
    parsed = parsed.replace(/\n/g, ' ');

    return parsed;
  };

  // Enhanced table parsing for research data
  const parseMarkdownTables = (text: string): string => {
    const tableRegex = /\|(.+)\|\n\|([:\-\s\|]+)\|\n((?:\|.+\|\n?)*)/gm;

    return text.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
      const headers = headerRow.split('|').map((h: string) => h.trim()).filter(Boolean);
      const rows = bodyRows.trim().split('\n').map((row: string) =>
        row.split('|').map((cell: string) => cell.trim()).filter(Boolean)
      );

      return `
        <div class="table-wrapper my-6 overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
          <table class="w-full text-sm">
            <thead class="bg-blue-50 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700">
              <tr>
                ${headers.map((header: string) => `<th class="px-4 py-3 text-left font-semibold text-blue-900 dark:text-blue-100">${header}</th>`).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              ${rows.map((row: string[]) => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  ${row.map((cell: string) => `<td class="px-4 py-3 text-gray-700 dark:text-gray-300">${cell}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    });
  };

  // Academic section parsing
  const parseAcademicSections = (text: string): string => {
    // Research paper keywords and sections
    const academicSections = [
      'Abstract', 'Introduction', 'Methodology', 'Results', 'Discussion',
      'Conclusion', 'References', 'Literature Review', 'Related Work',
      'Problem Statement', 'State of the Art', 'Limitations', 'Observations',
      'Key Innovation', 'Technical Solutions', 'Future Work'
    ];

    academicSections.forEach(section => {
      const regex = new RegExp(`^(${section}):?\\s*$`, 'gmi');
      text = text.replace(regex, `<h3 class="text-lg font-bold mt-6 mb-4 text-blue-800 dark:text-blue-200 border-l-4 border-blue-500 pl-4 bg-blue-50 dark:bg-blue-900/20 py-2 rounded-r">${section}</h3>`);
    });

    return text;
  };

  // Enhanced list parsing
  const parseEnhancedLists = (text: string): string => {
    const listBlocks = text.split('\n');
    let inList = false;
    let listType = 'ul';
    const processedLines = [];

    for (let i = 0; i < listBlocks.length; i++) {
      const line = listBlocks[i];
      const bulletMatch = line.match(/^- (.+)$/);
      const numberMatch = line.match(/^(\d+)\. (.+)$/);
      const isListItem = bulletMatch || numberMatch;
      const isContinuation = inList && line.match(/^\s+/) && line.trim();

      if (isListItem && !inList) {
        listType = bulletMatch ? 'ul' : 'ol';
        processedLines.push(`<${listType} class="space-y-3 my-4 pl-0">`);
        inList = true;
      } else if (!isListItem && !isContinuation && inList && line.trim() === '') {
        processedLines.push(`</${listType}>`);
        inList = false;
      }

      if (bulletMatch) {
        processedLines.push(`<li class="ml-6 list-disc text-gray-700 dark:text-gray-300 leading-relaxed">${bulletMatch[1]}</li>`);
      } else if (numberMatch) {
        processedLines.push(`<li class="ml-6 list-decimal text-gray-700 dark:text-gray-300 leading-relaxed">${numberMatch[2]}</li>`);
      } else if (isContinuation && inList) {
        if (processedLines.length > 0 && processedLines[processedLines.length - 1].includes('<li')) {
          const lastLine = processedLines.pop();
          if (lastLine) {
            processedLines.push(lastLine.replace('</li>', ' ' + line.trim() + '</li>'));
          }
        }
      } else {
        processedLines.push(line);
      }
    }

    if (inList) {
      processedLines.push(`</${listType}>`);
    }

    return processedLines.join('\n');
  };

  // Key-value pairs for structured research data
  const parseKeyValuePairs = (text: string): string => {
    // Match patterns like "Key: Value" or "Label: Description"
    const kvRegex = /^([A-Z][^:]*?):\s*(.+)$/gm;

    return text.replace(kvRegex, (match, key, value) => {
      // Only format if it looks like a research data point
      if (key.length < 50 && !key.includes('http') && !key.includes('.com')) {
        return `<div class="kv-pair mb-3 border-l-2 border-blue-300 dark:border-blue-600 pl-4 bg-blue-50/50 dark:bg-blue-900/10 py-2 rounded-r">
          <span class="font-semibold text-blue-800 dark:text-blue-200">${key}:</span>
          <span class="text-gray-700 dark:text-gray-300 ml-2">${value}</span>
        </div>`;
      }
      return match;
    });
  };

  return (
    <div className="text-gray-700 dark:text-gray-300">
      <div
        dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
        className="markdown-content leading-relaxed [&>p]:text-sm [&>ul]:text-sm [&>ol]:text-sm [&_li]:text-sm [&>h1]:text-gray-900 [&>h1]:dark:text-gray-100 [&>h2]:text-gray-900 [&>h2]:dark:text-gray-100 [&>h3]:text-gray-900 [&>h3]:dark:text-gray-100 [&>h4]:text-gray-900 [&>h4]:dark:text-gray-100"
      />
      {streaming && <span className="animate-pulse text-blue-500">▊</span>}
    </div>
  );
});