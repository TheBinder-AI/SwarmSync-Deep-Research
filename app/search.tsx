'use server';

import { createStreamableValue } from 'ai/rsc';
import { CoreMessage, streamText } from 'ai';
import { LangGraphSearchEngine, SearchEvent } from '@/lib/langgraph-search-engine';
import { TavilySearchEngine } from '@/lib/tavily-search';
import { FirecrawlClient } from '@/lib/firecrawl';

export async function search(
  query: string,
  context: Array<{ query: string; response: string }> = [],
  firecrawlKey?: string,
  model: 'openai' | 'gemini' = 'openai'
) {
  const stream = createStreamableValue<SearchEvent>();

  (async () => {
    try {
      // Choose search engine based on availability
      const useTavily = process.env.TAVILY_API_KEY && TavilySearchEngine.isAvailable();

      console.log('🔍 Search Engine Detection:', {
        hasTavilyKey: !!process.env.TAVILY_API_KEY,
        tavilyAvailable: TavilySearchEngine.isAvailable(),
        useTavily,
        modelProvider: model
      });

      if (useTavily) {
        console.log('🚀 Using Tavily AI search engine');
        // Use Tavily for faster, simpler search
        const tavilyApiKey = TavilySearchEngine.getApiKey()!;
        const searchEngine = new TavilySearchEngine(tavilyApiKey, model);

        await searchEngine.search(query, (event: SearchEvent) => {
          stream.update(event);
        }, context);

      } else {
        console.log('🐌 Falling back to LangGraph search engine');
        // Fallback to existing LangGraph + Firecrawl approach
        const firecrawlClient = new FirecrawlClient(
          firecrawlKey || process.env.FIRECRAWL_API_KEY
        );

        // Add timeout protection (5 minutes)
        const searchTimeout = setTimeout(() => {
          stream.update({
            type: 'error',
            error: 'Search is taking longer than expected. Please try a simpler query.',
            errorType: 'unknown'
          });
          stream.done();
        }, 5 * 60 * 1000);

        try {
          const searchEngine = new LangGraphSearchEngine(firecrawlClient);

          await searchEngine.search(query, (event: SearchEvent) => {
            try {
              stream.update(event);
            } catch (error) {
              console.error('Error updating stream:', error);
            }
          }, context);

          clearTimeout(searchTimeout);
        } catch (error) {
          clearTimeout(searchTimeout);
          console.error('LangGraph search error:', error);
          stream.update({
            type: 'error',
            error: error instanceof Error ? error.message : 'Search failed',
            errorType: 'search'
          });
        }
      }

    } catch (error) {
      console.error('Search error:', error);
      stream.update({
        type: 'error',
        error: error instanceof Error ? error.message : 'Search failed',
        errorType: 'search'
      });
    } finally {
      stream.done();
    }
  })();

  return { stream: stream.value };
}