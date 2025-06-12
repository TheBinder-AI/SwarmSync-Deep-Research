import { Source } from './langgraph-search-engine';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { ModelProvider, MODEL_PROVIDERS } from './config';

interface ProcessedSource extends Source {
  relevanceScore: number;
  extractedSections: string[];
  keywords: string[];
  summarized?: boolean;
}

export class ContextProcessor {
  // Configuration
  private readonly MAX_TOTAL_CHARS = 100000;
  private readonly MIN_CHARS_PER_SOURCE = 2000;
  private readonly MAX_CHARS_PER_SOURCE = 15000;
  private readonly CONTEXT_WINDOW_SIZE = 500; // chars before/after keyword match
  private readonly modelProvider: ModelProvider;

  constructor(modelProvider: ModelProvider = 'openai') {
    this.modelProvider = modelProvider;
  }

  /**
   * Get the appropriate model instance based on provider
   */
  private getModel(modelType: 'fast' | 'quality' = 'fast') {
    const config = MODEL_PROVIDERS[this.modelProvider];
    const modelName = modelType === 'fast' ? config.fastModel : config.qualityModel;

    switch (this.modelProvider) {
      case 'openai':
        return openai(modelName);
      case 'gemini':
        return google(modelName);
      default:
        throw new Error(`Unsupported model provider: ${this.modelProvider}`);
    }
  }

  /**
   * Process sources for optimal context selection
   */
  async processSources(
    query: string,
    sources: Source[],
    searchQueries: string[],
    onProgress?: (message: string, sourceUrl?: string) => void
  ): Promise<ProcessedSource[]> {
    // Fast path: if sources already have summaries, use them directly
    const sourcesWithSummaries = sources.filter(s => s.summary && s.summary.length > 20);

    if (sourcesWithSummaries.length >= Math.min(sources.length, 8)) {
      // Most sources already have summaries, skip heavy processing
      return sourcesWithSummaries.map(source => ({
        ...source,
        content: source.summary!, // Use summary as content
        relevanceScore: source.quality || 0.7, // Use existing quality score
        extractedSections: [source.summary!],
        keywords: this.extractKeywords(query, searchQueries),
        summarized: true
      })).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    // Limit number of sources to process for speed
    const sourcesToProcess = sources
      .filter(s => s.content || s.summary)
      .sort((a, b) => (b.quality || 0) - (a.quality || 0))
      .slice(0, 8); // Only process top 8 sources

    // Determine summary length based on number of sources
    const summaryLength = this.calculateSummaryLength(sourcesToProcess.length);

    // Process sources with fast model for speed
    const processedSources = await Promise.all(
      sourcesToProcess.map(source => this.summarizeSource(source, query, searchQueries, summaryLength, onProgress))
    );

    // Filter out failed sources and sort by relevance
    const validSources = processedSources
      .filter(s => s.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return validSources;
  }

  /**
   * Extract keywords from query and search queries
   */
  private extractKeywords(query: string, searchQueries: string[]): string[] {
    const allText = [query, ...searchQueries].join(' ').toLowerCase();

    // Remove common words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'what', 'when', 'where', 'how', 'why', 'who']);

    // Extract words, filter stopwords, and get unique keywords
    const words = allText
      .split(/\W+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Also extract quoted phrases
    const quotedPhrases = allText.match(/"([^"]+)"/g)?.map(p => p.replace(/"/g, '')) || [];

    return [...new Set([...words, ...quotedPhrases])];
  }

  /**
   * Process a single source to extract relevant sections and calculate relevance
   */
  private async processSource(
    source: Source,
    keywords: string[]
  ): Promise<ProcessedSource> {
    if (!source.content) {
      return {
        ...source,
        relevanceScore: 0,
        extractedSections: [],
        keywords: []
      };
    }

    const content = source.content.toLowerCase();
    const foundKeywords: string[] = [];
    const keywordPositions: { keyword: string; position: number }[] = [];

    // Find all keyword occurrences
    for (const keyword of keywords) {
      let position = content.indexOf(keyword);
      while (position !== -1) {
        keywordPositions.push({ keyword, position });
        if (!foundKeywords.includes(keyword)) {
          foundKeywords.push(keyword);
        }
        position = content.indexOf(keyword, position + 1);
      }
    }

    // Calculate relevance score
    const relevanceScore = this.calculateRelevanceScore(
      foundKeywords.length,
      keywordPositions.length,
      keywords.length,
      source.content.length
    );

    // Extract relevant sections around keywords
    const extractedSections = this.extractRelevantSections(
      source.content,
      keywordPositions
    );

    return {
      ...source,
      relevanceScore,
      extractedSections,
      keywords: foundKeywords
    };
  }

  /**
   * Calculate relevance score based on keyword matches
   */
  private calculateRelevanceScore(
    uniqueKeywordsFound: number,
    totalKeywordMatches: number,
    totalKeywords: number,
    contentLength: number
  ): number {
    // Coverage: what percentage of query keywords were found
    const coverage = totalKeywords > 0 ? uniqueKeywordsFound / totalKeywords : 0;

    // Density: keyword matches per 1000 characters
    const density = (totalKeywordMatches / contentLength) * 1000;

    // Normalize density (cap at 10 matches per 1000 chars)
    const normalizedDensity = Math.min(density / 10, 1);

    // Combined score (coverage is more important)
    return (coverage * 0.7) + (normalizedDensity * 0.3);
  }

  /**
   * Extract relevant sections around keyword matches
   */
  private extractRelevantSections(
    content: string,
    keywordPositions: { keyword: string; position: number }[]
  ): string[] {
    if (keywordPositions.length === 0) {
      // No keywords found, return beginning of content
      return [content.slice(0, this.MIN_CHARS_PER_SOURCE)];
    }

    // Sort positions
    keywordPositions.sort((a, b) => a.position - b.position);

    // Merge overlapping windows
    const windows: { start: number; end: number }[] = [];

    for (const { position } of keywordPositions) {
      const start = Math.max(0, position - this.CONTEXT_WINDOW_SIZE);
      const end = Math.min(content.length, position + this.CONTEXT_WINDOW_SIZE);

      // Check if this window overlaps with the last one
      if (windows.length > 0 && start <= windows[windows.length - 1].end) {
        // Extend the last window
        windows[windows.length - 1].end = end;
      } else {
        // Add new window
        windows.push({ start, end });
      }
    }

    // Extract sections, ensuring we capture sentence boundaries
    const sections: string[] = [];

    for (const window of windows) {
      // Extend to sentence boundaries
      let start = window.start;
      let end = window.end;

      // Find previous sentence boundary
      const prevPeriod = content.lastIndexOf('.', start);
      const prevNewline = content.lastIndexOf('\n', start);
      start = Math.max(prevPeriod + 1, prevNewline + 1, 0);

      // Find next sentence boundary
      const nextPeriod = content.indexOf('.', end);
      const nextNewline = content.indexOf('\n', end);
      if (nextPeriod !== -1 || nextNewline !== -1) {
        end = Math.min(
          nextPeriod !== -1 ? nextPeriod + 1 : content.length,
          nextNewline !== -1 ? nextNewline : content.length
        );
      }

      const section = content.slice(start, end).trim();
      if (section) {
        sections.push(section);
      }
    }

    return sections;
  }

  /**
   * Distribute character budget among sources based on relevance
   */
  private distributeCharacterBudget(
    sources: ProcessedSource[]
  ): ProcessedSource[] {
    // Filter out sources with no relevance
    const relevantSources = sources.filter(s => s.relevanceScore > 0);

    if (relevantSources.length === 0) {
      // Fallback: use first few sources
      return sources.slice(0, 5).map(s => ({
        ...s,
        content: s.content?.slice(0, this.MAX_CHARS_PER_SOURCE) || ''
      }));
    }

    // Calculate total relevance
    const totalRelevance = relevantSources.reduce((sum, s) => sum + s.relevanceScore, 0);

    // Distribute budget proportionally
    let remainingBudget = this.MAX_TOTAL_CHARS;
    const processedResults: ProcessedSource[] = [];

    for (const source of relevantSources) {
      if (remainingBudget <= 0) break;

      // Calculate this source's share
      const relevanceRatio = source.relevanceScore / totalRelevance;
      const allocatedChars = Math.floor(relevanceRatio * this.MAX_TOTAL_CHARS);

      // Apply min/max constraints
      const targetChars = Math.max(
        this.MIN_CHARS_PER_SOURCE,
        Math.min(allocatedChars, this.MAX_CHARS_PER_SOURCE, remainingBudget)
      );

      // Use extracted sections if available, otherwise use full content
      let processedContent: string;

      if (source.extractedSections.length > 0) {
        // Combine extracted sections
        processedContent = source.extractedSections.join('\n\n[...]\n\n');

        // If still too short, add more content around sections
        if (processedContent.length < targetChars && source.content) {
          const additionalContent = source.content.slice(0, targetChars - processedContent.length);
          processedContent = additionalContent + '\n\n[...]\n\n' + processedContent;
        }
      } else {
        // Use beginning of content
        processedContent = source.content?.slice(0, targetChars) || '';
      }

      // Ensure we don't exceed target
      if (processedContent.length > targetChars) {
        processedContent = processedContent.slice(0, targetChars) + '\n[... content truncated]';
      }

      remainingBudget -= processedContent.length;

      processedResults.push({
        ...source,
        content: processedContent
      });
    }

    return processedResults;
  }

  /**
   * Calculate optimal summary length based on source count
   */
  private calculateSummaryLength(sourceCount: number): number {
    if (sourceCount <= 5) return 4000;
    if (sourceCount <= 10) return 3000;
    if (sourceCount <= 20) return 2000;
    if (sourceCount <= 30) return 1500;
    return 1000;
  }

  /**
   * Summarize a single source using GPT-4o-mini
   */
  private async summarizeSource(
    source: Source,
    query: string,
    searchQueries: string[],
    targetLength: number,
    _onProgress?: (message: string, sourceUrl?: string) => void // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<ProcessedSource> {
    // If source already has a summary, use it
    if (source.summary && source.summary.length > 20) {
      const relevanceScore = this.calculateRelevanceFromSummary(source.summary, query, searchQueries);
      return {
        ...source,
        content: source.summary,
        relevanceScore,
        extractedSections: [source.summary],
        keywords: this.extractKeywords(query, searchQueries),
        summarized: true
      };
    }

    // If no content, return empty source
    if (!source.content || source.content.length < 100) {
      return {
        ...source,
        relevanceScore: 0,
        extractedSections: [],
        keywords: [],
        summarized: false
      };
    }

    try {
      // Use fast model for speed and concise prompt
      const result = await generateText({
        model: this.getModel('fast'), // Changed from 'quality' to 'fast'
        prompt: `Extract key information from this source that answers: "${query}"

**Source:** ${source.title}
**Content:** ${source.content.slice(0, 8000)} ${source.content.length > 8000 ? '\n[...truncated]' : ''}

**Instructions:**
- Extract only information directly relevant to the question
- Include specific facts, numbers, dates, names
- Keep it under ${targetLength} characters
- If not relevant, say "No direct relevance"

**Key information:**`,
        temperature: 0.1, // Lower temperature for consistency
        maxTokens: Math.ceil(targetLength / 3), // Rough token estimation
      });

      const summary = result.text.trim();

      // Calculate a simple relevance score based on the summary
      const relevanceScore = this.calculateRelevanceFromSummary(summary, query, searchQueries);

      return {
        ...source,
        content: summary,
        relevanceScore,
        extractedSections: [summary],
        keywords: this.extractKeywords(query, searchQueries),
        summarized: true
      };
    } catch (error) {
      console.warn(`Failed to summarize source ${source.url}:`, error);

      // Fallback to keyword extraction method (no LLM calls)
      const keywords = this.extractKeywords(query, searchQueries);
      const processed = await this.processSource(source, keywords);

      return processed;
    }
  }

  /**
   * Calculate relevance score from summary
   */
  private calculateRelevanceFromSummary(
    summary: string,
    query: string,
    searchQueries: string[]
  ): number {
    // Simple heuristic: longer summaries with more specific content are more relevant
    const summaryLength = summary.length;

    // Check if summary indicates low relevance
    const lowRelevancePhrases = [
      'not directly related',
      'no specific information',
      'doesn\'t mention',
      'no relevant content',
      'unrelated to'
    ];

    const summaryLower = summary.toLowerCase();
    const hasLowRelevance = lowRelevancePhrases.some(phrase =>
      summaryLower.includes(phrase)
    );

    if (hasLowRelevance) {
      return 0.1; // Very low relevance
    }

    // Check for high relevance indicators
    const highRelevanceIndicators = [
      'specifically mentions',
      'directly addresses',
      'provides detailed',
      'explains how',
      'data shows',
      'research indicates'
    ];

    const hasHighRelevance = highRelevanceIndicators.some(phrase =>
      summaryLower.includes(phrase)
    );

    // Calculate score
    let score = Math.min(summaryLength / 2000, 1.0); // Base score from length

    if (hasHighRelevance) {
      score = Math.min(score + 0.3, 1.0);
    }

    // Check keyword density in summary
    const keywords = this.extractKeywords(query, searchQueries);
    const keywordMatches = keywords.filter(keyword =>
      summaryLower.includes(keyword.toLowerCase())
    ).length;

    const keywordScore = keywords.length > 0
      ? keywordMatches / keywords.length
      : 0.5;

    // Combined score
    return (score * 0.6) + (keywordScore * 0.4);
  }
}