import { StateGraph, END, START, Annotation, MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Runnable, RunnableLambda, type RunnableConfig } from "@langchain/core/runnables";
import { FirecrawlClient } from '@/lib/firecrawl';
import { ContextProcessor } from '@/lib/context-processor';
import { SEARCH_CONFIG } from '@/lib/config';

// Model provider type
export type ModelProvider = 'openai' | 'gemini';

// Model configuration interface
export interface ModelConfig {
  provider: ModelProvider;
  fastModel: string;
  qualityModel: string;
  temperature: number;
  apiKey?: string;
}

// Default model configurations
export const MODEL_CONFIGS: Record<ModelProvider, Omit<ModelConfig, 'apiKey'>> = {
  openai: {
    provider: 'openai',
    fastModel: 'gpt-4o-mini',
    qualityModel: 'gpt-4o',
    temperature: 0,
  },
  gemini: {
    provider: 'gemini',
    fastModel: 'gemini-1.5-flash',
    qualityModel: 'gemini-1.5-pro',
    temperature: 0,
  },
} as const;

// Event types remain the same for frontend compatibility
export type SearchPhase =
  | 'understanding'
  | 'planning'
  | 'searching'
  | 'analyzing'
  | 'synthesizing'
  | 'complete'
  | 'error';

export type SearchEvent =
  | { type: 'phase-update'; phase: SearchPhase; message: string }
  | { type: 'thinking'; message: string }
  | { type: 'searching'; query: string; index: number; total: number }
  | { type: 'found'; sources: Source[]; query: string }
  | { type: 'scraping'; url: string; index: number; total: number; query: string }
  | { type: 'content-chunk'; chunk: string }
  | { type: 'final-result'; content: string; sources: Source[]; followUpQuestions?: string[] }
  | { type: 'error'; error: string; errorType?: ErrorType }
  | { type: 'source-processing'; url: string; title: string; stage: 'browsing' | 'extracting' | 'analyzing' }
  | { type: 'source-complete'; url: string; summary: string };

export type ErrorType = 'search' | 'scrape' | 'llm' | 'unknown';

export interface Source {
  url: string;
  title: string;
  content?: string;
  quality?: number;
  summary?: string;
}

export interface SearchResult {
  url: string;
  title: string;
  content?: string;
  markdown?: string;
}

export interface SearchStep {
  id: SearchPhase | string;
  label: string;
  status: 'pending' | 'active' | 'completed';
  startTime?: number;
}

// Proper LangGraph state using Annotation with reducers
const SearchStateAnnotation = Annotation.Root({
  // Input fields
  query: Annotation<string>({
    reducer: (_, y) => y ?? "",
    default: () => ""
  }),
  context: Annotation<{ query: string; response: string }[] | undefined>({
    reducer: (_, y) => y,
    default: () => undefined
  }),

  // Process fields
  understanding: Annotation<string | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  searchQueries: Annotation<string[] | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  currentSearchIndex: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0
  }),

  // Results fields - with proper array reducers
  sources: Annotation<Source[]>({
    reducer: (existing: Source[], update: Source[] | undefined) => {
      if (!update) return existing;
      // Deduplicate sources by URL
      const sourceMap = new Map<string, Source>();
      [...existing, ...update].forEach(source => {
        sourceMap.set(source.url, source);
      });
      return Array.from(sourceMap.values());
    },
    default: () => []
  }),
  scrapedSources: Annotation<Source[]>({
    reducer: (existing: Source[], update: Source[] | undefined) => {
      if (!update) return existing;
      return [...existing, ...update];
    },
    default: () => []
  }),
  processedSources: Annotation<Source[] | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  finalAnswer: Annotation<string | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  followUpQuestions: Annotation<string[] | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),

  // Answer tracking
  subQueries: Annotation<Array<{
    question: string;
    searchQuery: string;
    answered: boolean;
    answer?: string;
    confidence: number;
    sources: string[];
  }> | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  searchAttempt: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0
  }),

  // Control fields
  phase: Annotation<SearchPhase>({
    reducer: (x, y) => y ?? x,
    default: () => 'understanding' as SearchPhase
  }),
  error: Annotation<string | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  errorType: Annotation<ErrorType | undefined>({
    reducer: (x, y) => y ?? x,
    default: () => undefined
  }),
  maxRetries: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => SEARCH_CONFIG.MAX_RETRIES
  }),
  retryCount: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0
  })
});

type SearchState = typeof SearchStateAnnotation.State;

// Define config type for proper event handling
interface GraphConfig {
  configurable?: {
    eventCallback?: (event: SearchEvent) => void;
    checkpointId?: string;
  };
}

export class LangGraphSearchEngine {
  private firecrawl: FirecrawlClient;
  private contextProcessor: ContextProcessor;
  private graph: ReturnType<typeof this.buildGraph>;
  private llm!: ChatOpenAI | ChatGoogleGenerativeAI; // Definite assignment assertion
  private streamingLlm!: ChatOpenAI | ChatGoogleGenerativeAI; // Definite assignment assertion
  private checkpointer?: MemorySaver;
  private modelProvider: ModelProvider;

  constructor(
    firecrawl: FirecrawlClient,
    options?: {
      enableCheckpointing?: boolean;
      modelProvider?: ModelProvider;
    }
  ) {
    this.firecrawl = firecrawl;

    // Auto-detect provider if not specified or if set to "auto"
    this.modelProvider = this.determineProvider(options?.modelProvider);
    this.contextProcessor = new ContextProcessor(this.modelProvider);

    // Initialize models based on provider
    this.initializeModels();

    // Enable checkpointing if requested
    if (options?.enableCheckpointing) {
      this.checkpointer = new MemorySaver();
    }

    this.graph = this.buildGraph();
  }

  /**
   * Determine which provider to use based on availability
   */
  private determineProvider(requestedProvider?: ModelProvider | "auto"): ModelProvider {
    // If a specific provider is requested, validate it's available
    if (requestedProvider && requestedProvider !== "auto") {
      if (LangGraphSearchEngine.isProviderAvailable(requestedProvider)) {
        return requestedProvider;
      } else {
        console.warn(`Requested provider '${requestedProvider}' is not available (missing API key). Auto-detecting...`);
      }
    }

    // Auto-detect first available provider
    const availableProviders = LangGraphSearchEngine.getAvailableProviders();
    for (const provider of availableProviders) {
      if (LangGraphSearchEngine.isProviderAvailable(provider)) {
        console.log(`Auto-detected and using '${provider}' provider`);
        return provider;
      }
    }

    // If no providers are available, throw a helpful error
    const providerInfo = availableProviders.map(p => {
      const envVar = p === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY';
      return `${p.toUpperCase()}: ${envVar}`;
    }).join(', ');

    throw new Error(
      `No AI providers are available. Please set one of the following environment variables:\n${providerInfo}`
    );
  }

  /**
   * Initialize LLM models based on the selected provider
   */
  private initializeModels(): void {
    const config = MODEL_CONFIGS[this.modelProvider];

    switch (this.modelProvider) {
      case 'openai': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error('OPENAI_API_KEY environment variable is not set');
        }

        this.llm = new ChatOpenAI({
          modelName: config.fastModel,
          temperature: config.temperature,
          openAIApiKey: apiKey,
        });

        this.streamingLlm = new ChatOpenAI({
          modelName: config.qualityModel,
          temperature: config.temperature,
          streaming: true,
          openAIApiKey: apiKey,
        });
        break;
      }

      case 'gemini': {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
          throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set');
        }

        this.llm = new ChatGoogleGenerativeAI({
          model: config.fastModel,
          temperature: config.temperature,
          apiKey: apiKey,
        });

        this.streamingLlm = new ChatGoogleGenerativeAI({
          model: config.qualityModel,
          temperature: config.temperature,
          streaming: true,
          apiKey: apiKey,
        });
        break;
      }

      default:
        throw new Error(`Unsupported model provider: ${this.modelProvider}`);
    }
  }

  /**
   * Get the current model provider
   */
  getModelProvider(): ModelProvider {
    return this.modelProvider;
  }

  /**
   * Switch model provider (requires re-initialization)
   */
  async switchModelProvider(provider: ModelProvider): Promise<void> {
    if (provider === this.modelProvider) {
      return; // Already using this provider
    }

    this.modelProvider = provider;
    this.contextProcessor = new ContextProcessor(provider);
    this.initializeModels();
    this.graph = this.buildGraph();
  }

  getInitialSteps(): SearchStep[] {
    return [
      { id: 'understanding', label: 'Understanding question', status: 'pending' },
      { id: 'planning', label: 'Planning approach', status: 'pending' },
      { id: 'searching', label: 'Exploring web', status: 'pending' },
      { id: 'analyzing', label: 'Connecting dots', status: 'pending' },
      { id: 'synthesizing', label: 'Crafting answer', status: 'pending' },
      { id: 'complete', label: 'Ready! ✨', status: 'pending' }
    ];
  }

  private buildGraph() {
    // Create closures for helper methods
    const analyzeQuery = this.analyzeQuery.bind(this);
    const scoreContent = this.scoreContent.bind(this);
    const summarizeContent = this.summarizeContent.bind(this);
    const generateStreamingAnswer = this.generateStreamingAnswer.bind(this);
    const generateFollowUpQuestions = this.generateFollowUpQuestions.bind(this);
    const firecrawl = this.firecrawl;
    const contextProcessor = this.contextProcessor;

    const workflow = new StateGraph(SearchStateAnnotation)
      // Understanding node
      .addNode("understand", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'understanding',
            message: 'Analyzing your request...'
          });
        }

        try {
          const understanding = await analyzeQuery(state.query, state.context);

          if (eventCallback) {
            eventCallback({
              type: 'thinking',
              message: understanding
            });
          }

          return {
            understanding,
            phase: 'planning' as SearchPhase
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Failed to understand query',
            errorType: 'llm' as ErrorType,
            phase: 'error' as SearchPhase
          };
        }
      })

      // Planning node
      .addNode("plan", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'planning',
            message: 'Planning search strategy...'
          });
        }

        try {
          // SPEED MODE: Skip complex sub-query extraction
          if (SEARCH_CONFIG.SPEED_MODE) {
            const searchQueries = [state.query]; // Just use the original query

            if (eventCallback) {
              eventCallback({
                type: 'thinking',
                message: `Quick search strategy: using direct query approach for speed`
              });
            }

            return {
              searchQueries,
              currentSearchIndex: 0,
              phase: 'searching' as SearchPhase
            };
          }

          // NORMAL MODE: Full sub-query extraction and planning
          // Extract sub-queries if not already done
          let subQueries = state.subQueries;
          if (!subQueries) {
            const extractSubQueries = this.extractSubQueries.bind(this);
            const extracted = await extractSubQueries(state.query);

            subQueries = extracted.map(sq => ({
              question: sq.question,
              searchQuery: sq.searchQuery,
              answered: false,
              confidence: 0,
              sources: []
            }));
          }

          // Generate search queries for unanswered questions
          const unansweredQueries = subQueries.filter(sq => !sq.answered || sq.confidence < SEARCH_CONFIG.MIN_ANSWER_CONFIDENCE);

          if (unansweredQueries.length === 0) {
            // All questions answered, skip to analysis
            return {
              subQueries,
              phase: 'analyzing' as SearchPhase
            };
          }

          // Use alternative search queries if this is a retry
          let searchQueries: string[];
          if (state.searchAttempt > 0) {
            const generateAlternativeSearchQueries = this.generateAlternativeSearchQueries.bind(this);
            searchQueries = await generateAlternativeSearchQueries(subQueries, state.searchAttempt);

            // Update sub-queries with new search queries
            let alternativeIndex = 0;
            subQueries.forEach(sq => {
              if (!sq.answered || sq.confidence < SEARCH_CONFIG.MIN_ANSWER_CONFIDENCE) {
                if (alternativeIndex < searchQueries.length) {
                  sq.searchQuery = searchQueries[alternativeIndex];
                  alternativeIndex++;
                }
              }
            });
          } else {
            // First attempt - use the search queries from sub-queries
            searchQueries = unansweredQueries.map(sq => sq.searchQuery);
          }

          if (eventCallback) {
            if (state.searchAttempt === 0) {
              eventCallback({
                type: 'thinking',
                message: searchQueries.length > 3
                  ? `I detected ${subQueries.length} different questions. I'll search for each one separately.`
                  : `I'll search for information to answer your question.`
              });
            } else {
              eventCallback({
                type: 'thinking',
                message: `Trying alternative search strategies for: ${unansweredQueries.map(sq => sq.question).join(', ')}`
              });
            }
          }

          return {
            searchQueries,
            subQueries,
            currentSearchIndex: 0,
            phase: 'searching' as SearchPhase
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Failed to plan search',
            errorType: 'llm' as ErrorType,
            phase: 'error' as SearchPhase
          };
        }
      })

      // Search node (handles one search at a time)
      .addNode("search", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;
        const searchQueries = state.searchQueries || [];
        const currentIndex = state.currentSearchIndex || 0;

        if (currentIndex === 0 && eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'searching',
            message: 'Searching the web...'
          });
        }

        if (currentIndex >= searchQueries.length) {
          return {
            phase: 'scrape' as SearchPhase
          };
        }

        const searchQuery = searchQueries[currentIndex];

        if (eventCallback) {
          eventCallback({
            type: 'searching',
            query: searchQuery,
            index: currentIndex + 1,
            total: searchQueries.length
          });
        }

        try {
          const results = await this.firecrawl.search(searchQuery, {
            limit: SEARCH_CONFIG.MAX_SOURCES_PER_SEARCH,
            scrapeOptions: {
              formats: ['markdown']
            }
          });

          const newSources: Source[] = results.data.map((r: SearchResult) => ({
            url: r.url,
            title: r.title,
            content: r.markdown || r.content || '',
            quality: 0
          }));

          if (eventCallback) {
            eventCallback({
              type: 'found',
              sources: newSources,
              query: searchQuery
            });
          }

          // Process sources in parallel for better performance
          if (SEARCH_CONFIG.PARALLEL_SUMMARY_GENERATION) {
            await Promise.all(newSources.map(async (source) => {
              // Score the content
              source.quality = this.scoreContent(source.content || '', state.query);

              // Generate summary if content is available
              if (source.content && source.content.length > SEARCH_CONFIG.MIN_CONTENT_LENGTH) {
                const summary = await this.summarizeContent(source.content, searchQuery);

                // Store the summary in the source object
                if (summary && !summary.toLowerCase().includes('no specific')) {
                  source.summary = summary;

                  if (eventCallback) {
                    eventCallback({
                      type: 'source-complete',
                      url: source.url,
                      summary: summary
                    });
                  }
                }
              }
            }));
          } else {
            // Original sequential processing with abort checking
            for (const source of newSources) {
              // Small delay for animation
              await new Promise(resolve => setTimeout(resolve, SEARCH_CONFIG.SOURCE_ANIMATION_DELAY));

              // Score the content
              source.quality = this.scoreContent(source.content || '', state.query);

              // Generate summary if content is available
              if (source.content && source.content.length > SEARCH_CONFIG.MIN_CONTENT_LENGTH) {
                const summary = await this.summarizeContent(source.content, searchQuery);

                // Store the summary in the source object
                if (summary && !summary.toLowerCase().includes('no specific')) {
                  source.summary = summary;

                  if (eventCallback) {
                    eventCallback({
                      type: 'source-complete',
                      url: source.url,
                      summary: summary
                    });
                  }
                }
              }
            }
          }

          return {
            sources: newSources,
            currentSearchIndex: currentIndex + 1
          };
        } catch {
          return {
            currentSearchIndex: currentIndex + 1,
            errorType: 'search' as ErrorType
          };
        }
      })

      // Scraping node
      .addNode("scrape", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;
        const sourcesToScrape = state.sources?.filter(s =>
          !s.content || s.content.length < SEARCH_CONFIG.MIN_CONTENT_LENGTH
        ) || [];
        const newScrapedSources: Source[] = [];

        // Sources with content were already processed in search node, just pass them through
        const sourcesWithContent = state.sources?.filter(s =>
          s.content && s.content.length >= SEARCH_CONFIG.MIN_CONTENT_LENGTH
        ) || [];
        newScrapedSources.push(...sourcesWithContent);

        // Then scrape sources without content
        for (let i = 0; i < Math.min(sourcesToScrape.length, SEARCH_CONFIG.MAX_SOURCES_TO_SCRAPE); i++) {
          const source = sourcesToScrape[i];

          if (eventCallback) {
            eventCallback({
              type: 'scraping',
              url: source.url,
              index: newScrapedSources.length + 1,
              total: sourcesWithContent.length + Math.min(sourcesToScrape.length, SEARCH_CONFIG.MAX_SOURCES_TO_SCRAPE),
              query: state.query
            });
          }

          try {
            const scraped = await this.firecrawl.scrapeUrl(source.url, SEARCH_CONFIG.SCRAPE_TIMEOUT);
            if (scraped.success && scraped.markdown) {
              const enrichedSource = {
                ...source,
                content: scraped.markdown,
                quality: this.scoreContent(scraped.markdown, state.query)
              };
              newScrapedSources.push(enrichedSource);

              // Show processing animation
              if (eventCallback) {
                eventCallback({
                  type: 'source-processing',
                  url: source.url,
                  title: source.title,
                  stage: 'browsing'
                });
              }

              await new Promise(resolve => setTimeout(resolve, 150));

              const summary = await this.summarizeContent(scraped.markdown, state.query);
              if (summary) {
                enrichedSource.summary = summary;

                if (eventCallback) {
                  eventCallback({
                    type: 'source-complete',
                    url: source.url,
                    summary: summary
                  });
                }
              }
            } else if (scraped.error === 'timeout') {
              if (eventCallback) {
                eventCallback({
                  type: 'thinking',
                  message: `${new URL(source.url).hostname} is taking too long to respond, moving on...`
                });
              }
            }
          } catch {
            if (eventCallback) {
              eventCallback({
                type: 'thinking',
                message: `Couldn't access ${new URL(source.url).hostname}, trying other sources...`
              });
            }
          }
        }

        return {
          scrapedSources: newScrapedSources,
          phase: 'analyzing' as SearchPhase
        };
      })

      // Analyzing node
      .addNode("analyze", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'analyzing',
            message: 'Analyzing gathered information...'
          });
        }

        // Combine sources and remove duplicates by URL
        const sourceMap = new Map<string, Source>();

        // Add all sources (not just those with long content, since summaries contain key info)
        (state.sources || []).forEach(s => sourceMap.set(s.url, s));

        // Add scraped sources (may override with better content)
        (state.scrapedSources || []).forEach(s => sourceMap.set(s.url, s));

        const allSources = Array.from(sourceMap.values());

        // SPEED MODE: Skip complex answer checking and retries
        if (SEARCH_CONFIG.SPEED_MODE) {
          if (eventCallback && allSources.length > 0) {
            eventCallback({
              type: 'thinking',
              message: `Found ${allSources.length} sources - moving to synthesis for speed`
            });
          }

          try {
            // Simple source processing for speed
            const processedSources = allSources
              .filter(s => s.content || s.summary)
              .sort((a, b) => {
                // Prioritize sources with summaries
                if (a.summary && !b.summary) return -1;
                if (!a.summary && b.summary) return 1;
                // Then by quality
                return (b.quality || 0) - (a.quality || 0);
              })
              .slice(0, SEARCH_CONFIG.MAX_SOURCES_TO_CHECK);

            return {
              sources: allSources,
              processedSources,
              phase: 'synthesizing' as SearchPhase
            };
          } catch {
            return {
              sources: allSources,
              processedSources: allSources,
              phase: 'synthesizing' as SearchPhase
            };
          }
        }

        // NORMAL MODE: Full answer checking and retry logic (original complex logic)
        // Check which questions have been answered
        if (state.subQueries) {
          const checkAnswersInSources = this.checkAnswersInSources.bind(this);
          const updatedSubQueries = await checkAnswersInSources(state.subQueries, allSources);

          const answeredCount = updatedSubQueries.filter(sq => sq.answered).length;
          const totalQuestions = updatedSubQueries.length;
          const searchAttempt = (state.searchAttempt || 0) + 1;

          // Check if we have partial answers with decent confidence
          const partialAnswers = updatedSubQueries.filter(sq => sq.confidence >= 0.3);
          const hasPartialInfo = partialAnswers.length > answeredCount;

          if (eventCallback) {
            if (answeredCount === totalQuestions) {
              eventCallback({
                type: 'thinking',
                message: `Found answers to all ${totalQuestions} questions across ${allSources.length} sources`
              });
            } else if (answeredCount > 0) {
              eventCallback({
                type: 'thinking',
                message: `Found answers to ${answeredCount} of ${totalQuestions} questions. Still missing: ${updatedSubQueries.filter(sq => !sq.answered).map(sq => sq.question).join(', ')}`
              });
            } else if (searchAttempt >= SEARCH_CONFIG.MAX_SEARCH_ATTEMPTS) {
              // Only show "could not find" message when we've exhausted all attempts
              eventCallback({
                type: 'thinking',
                message: `Could not find specific answers in ${allSources.length} sources. The information may not be publicly available.`
              });
            } else if (hasPartialInfo && searchAttempt >= 3) {
              // If we have partial info and tried 3+ times, stop searching
              eventCallback({
                type: 'thinking',
                message: `Found partial information. Moving forward with what's available.`
              });
            } else {
              // For intermediate attempts, show a different message
              eventCallback({
                type: 'thinking',
                message: `Searching for more specific information...`
              });
            }
          }

          // If we haven't found all answers and haven't exceeded attempts, try again
          // BUT stop if we have partial info and already tried 2+ times
          if (answeredCount < totalQuestions &&
            searchAttempt < SEARCH_CONFIG.MAX_SEARCH_ATTEMPTS &&
            !(hasPartialInfo && searchAttempt >= 2)) {
            return {
              sources: allSources,
              subQueries: updatedSubQueries,
              searchAttempt,
              phase: 'planning' as SearchPhase  // Go back to planning for retry
            };
          }

          // Otherwise proceed with what we have
          try {
            let processedSources: Source[];

            if (SEARCH_CONFIG.SPEED_MODE) {
              // Speed mode: use sources directly, prioritize those with summaries
              processedSources = allSources
                .filter(s => s.content || s.summary)
                .sort((a, b) => {
                  // Prioritize sources with summaries
                  if (a.summary && !b.summary) return -1;
                  if (!a.summary && b.summary) return 1;
                  // Then by quality
                  return (b.quality || 0) - (a.quality || 0);
                })
                .slice(0, SEARCH_CONFIG.MAX_SOURCES_TO_CHECK);
            } else {
              // Normal mode: full context processing
              processedSources = await this.contextProcessor.processSources(
                state.query,
                allSources,
                state.searchQueries || []
              );
            }

            return {
              sources: allSources,
              processedSources,
              subQueries: updatedSubQueries,
              searchAttempt,
              phase: 'synthesizing' as SearchPhase
            };
          } catch {
            return {
              sources: allSources,
              processedSources: allSources,
              subQueries: updatedSubQueries,
              searchAttempt,
              phase: 'synthesizing' as SearchPhase
            };
          }
        } else {
          // Fallback for queries without sub-queries
          if (eventCallback && allSources.length > 0) {
            eventCallback({
              type: 'thinking',
              message: `Found ${allSources.length} sources with quality information`
            });
          }

          try {
            let processedSources: Source[];

            if (SEARCH_CONFIG.SPEED_MODE) {
              // Speed mode: use sources directly, prioritize those with summaries
              processedSources = allSources
                .filter(s => s.content || s.summary)
                .sort((a, b) => {
                  // Prioritize sources with summaries
                  if (a.summary && !b.summary) return -1;
                  if (!a.summary && b.summary) return 1;
                  // Then by quality
                  return (b.quality || 0) - (a.quality || 0);
                })
                .slice(0, SEARCH_CONFIG.MAX_SOURCES_TO_CHECK);
            } else {
              // Normal mode: full context processing
              processedSources = await this.contextProcessor.processSources(
                state.query,
                allSources,
                state.searchQueries || []
              );
            }

            return {
              sources: allSources,
              processedSources,
              phase: 'synthesizing' as SearchPhase
            };
          } catch {
            return {
              sources: allSources,
              processedSources: allSources,
              phase: 'synthesizing' as SearchPhase
            };
          }
        }
      })

      // Synthesizing node with streaming
      .addNode("synthesize", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'synthesizing',
            message: 'Creating comprehensive answer...'
          });
        }

        try {
          const sourcesToUse = state.processedSources || state.sources || [];

          const answer = await generateStreamingAnswer(
            state.query,
            sourcesToUse,
            (chunk) => {
              if (eventCallback) {
                eventCallback({ type: 'content-chunk', chunk });
              }
            },
            state.context
          );

          // Generate follow-up questions
          const followUpQuestions = await generateFollowUpQuestions(
            state.query,
            answer,
            sourcesToUse,
            state.context
          );

          return {
            finalAnswer: answer,
            followUpQuestions,
            phase: 'complete' as SearchPhase
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Failed to generate answer',
            errorType: 'llm' as ErrorType,
            phase: 'error' as SearchPhase
          };
        }
      })

      // Error handling node
      .addNode("handleError", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'error',
            error: state.error || 'An unknown error occurred',
            errorType: state.errorType
          });
        }

        // Retry logic based on error type
        if ((state.retryCount || 0) < (state.maxRetries || SEARCH_CONFIG.MAX_RETRIES)) {

          // Different retry strategies based on error type
          const retryPhase = state.errorType === 'search' ? 'searching' : 'understanding';

          return {
            retryCount: (state.retryCount || 0) + 1,
            phase: retryPhase as SearchPhase,
            error: undefined,
            errorType: undefined
          };
        }

        return {
          phase: 'error' as SearchPhase
        };
      })

      // Complete node
      .addNode("complete", async (state: SearchState, config?: GraphConfig): Promise<Partial<SearchState>> => {
        const eventCallback = config?.configurable?.eventCallback;

        if (eventCallback) {
          eventCallback({
            type: 'phase-update',
            phase: 'complete',
            message: 'Search complete!'
          });

          eventCallback({
            type: 'final-result',
            content: state.finalAnswer || '',
            sources: state.sources || [],
            followUpQuestions: state.followUpQuestions
          });
        }

        return {
          phase: 'complete' as SearchPhase
        };
      });

    // Add edges with proper conditional routing
    workflow
      .addEdge(START, "understand")
      .addConditionalEdges(
        "understand",
        (state: SearchState) => state.phase === 'error' ? "handleError" : "plan",
        {
          handleError: "handleError",
          plan: "plan"
        }
      )
      .addConditionalEdges(
        "plan",
        (state: SearchState) => state.phase === 'error' ? "handleError" : "search",
        {
          handleError: "handleError",
          search: "search"
        }
      )
      .addConditionalEdges(
        "search",
        (state: SearchState) => {
          if (state.phase === 'error') return "handleError";
          if ((state.currentSearchIndex || 0) < (state.searchQueries?.length || 0)) {
            return "search"; // Continue searching
          }
          return "scrape"; // Move to scraping
        },
        {
          handleError: "handleError",
          search: "search",
          scrape: "scrape"
        }
      )
      .addConditionalEdges(
        "scrape",
        (state: SearchState) => state.phase === 'error' ? "handleError" : "analyze",
        {
          handleError: "handleError",
          analyze: "analyze"
        }
      )
      .addConditionalEdges(
        "analyze",
        (state: SearchState) => {
          if (state.phase === 'error') return "handleError";
          if (state.phase === 'planning') return "plan";  // Retry with new searches
          return "synthesize";
        },
        {
          handleError: "handleError",
          plan: "plan",
          synthesize: "synthesize"
        }
      )
      .addConditionalEdges(
        "synthesize",
        (state: SearchState) => state.phase === 'error' ? "handleError" : "complete",
        {
          handleError: "handleError",
          complete: "complete"
        }
      )
      .addConditionalEdges(
        "handleError",
        (state: SearchState) => state.phase === 'error' ? END : "understand",
        {
          [END]: END,
          understand: "understand"
        }
      )
      .addEdge("complete", END);

    // Compile with optional checkpointing
    return workflow.compile(this.checkpointer ? { checkpointer: this.checkpointer } : undefined);
  }

  async search(
    query: string,
    onEvent: (event: SearchEvent) => void,
    context?: { query: string; response: string }[],
    checkpointId?: string
  ): Promise<void> {
    try {
      const initialState: SearchState = {
        query,
        context,
        sources: [],
        scrapedSources: [],
        processedSources: undefined,
        phase: 'understanding',
        currentSearchIndex: 0,
        maxRetries: SEARCH_CONFIG.MAX_RETRIES,
        retryCount: 0,
        understanding: undefined,
        searchQueries: undefined,
        finalAnswer: undefined,
        followUpQuestions: undefined,
        error: undefined,
        errorType: undefined,
        subQueries: undefined,
        searchAttempt: 0
      };

      // Configure with event callback
      const config: GraphConfig = {
        configurable: {
          eventCallback: onEvent,
          ...(checkpointId && this.checkpointer ? { thread_id: checkpointId } : {})
        }
      };

      // Invoke the graph with increased recursion limit
      await this.graph.invoke(initialState, {
        ...config,
        recursionLimit: 35  // Increased from default 25 to handle MAX_SEARCH_ATTEMPTS=5
      });
    } catch (error) {
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Search failed',
        errorType: 'unknown'
      });
    }
  }

  // Get current date for context
  private getCurrentDateContext(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    return `Today's date is ${dateStr}. The current year is ${year} and it's currently ${month}/${year}.`;
  }

  // Pure helper methods (no side effects)
  private async analyzeQuery(query: string, context?: { query: string; response: string }[]): Promise<string> {
    let contextPrompt = '';
    if (context && context.length > 0) {
      contextPrompt = '\n\n**Previous Conversation:**\n';
      context.forEach(c => {
        contextPrompt += `You: ${c.query}\nMe: ${c.response.substring(0, SEARCH_CONFIG.CONTEXT_PREVIEW_LENGTH)}...\n\n`;
      });
    }

    const messages = [
      new SystemMessage(`${this.getCurrentDateContext()}

Hi! I'm your research assistant and I want to understand exactly what you're looking for.

**My Job:**
✅ Give you a clear title for your research (like "Exploring AI breakthroughs" or "Understanding climate solutions")  
✅ Explain in 1-2 sentences what specific aspects you want to know about
✅ Connect this to our previous conversation if relevant
✅ Let you know I'll search for the best information to help

**Important:** I only mention "latest" information if you're specifically asking about recent events or current trends.

Let me keep this natural and show I truly get what you're asking for! 🌟`),
      new HumanMessage(`Your question: "${query}"${contextPrompt}`)
    ];

    const response = await this.llm.invoke(messages);
    return response.content.toString();
  }

  private async checkAnswersInSources(
    subQueries: Array<{ question: string; searchQuery: string; answered: boolean; answer?: string; confidence: number; sources: string[] }>,
    sources: Source[]
  ): Promise<typeof subQueries> {
    if (sources.length === 0) return subQueries;

    const messages = [
      new SystemMessage(`Hey! I need to check which questions have been answered by the sources we found.

**What I'm Looking For:**
🔍 Direct answers in the sources
📊 Confidence level (0.0-1.0) that each question was fully answered  
📝 Brief answer summary if found

**My Guidelines:**
✅ **"Who" questions about people/founders:** Answered (0.8+ confidence) if I find specific names
✅ **"What" questions:** Answered (0.8+ confidence) if I find the specific info requested
✅ **"When" questions:** Answered (0.8+ confidence) if I find dates or time periods
✅ **"How many" questions:** Need specific numbers (0.8+ confidence)
✅ **Comparison questions:** Need info about all items being compared
📋 **Partial info but missing details:** Medium confidence (0.6-0.7)
❌ **Sources mention topic but don't answer specific question:** Low confidence (< 0.3)

**Special Version Matching:**
- "0528" in question matches "0528", "-0528", "May 28", or "May 28, 2025" in sources
- Example: "DeepSeek R1 0528" is ANSWERED if sources mention:
  - "DeepSeek R1-0528" (exact match)
  - "DeepSeek R1 updated May 28" (date match)
  - Hyphens and spaces in versions are ignored when matching

**Special Product Cases:**
- Product with version (e.g., "ModelX v2.5.1" or "Product 0528"):
  - Exact version mentioned → High confidence (0.8+)
  - Only base product mentioned → Medium confidence (0.6+)
- Multiple contradicting sources → Low confidence (0.3) but provide available info

**Important:** I'm generous in recognizing clear answers. If sources clearly provide what's asked (e.g., "The founders are X, Y, and Z"), I mark it as answered with high confidence.

**Format:** Return ONLY a JSON array, no markdown or code blocks:
[
  {
    "question": "the original question",
    "answered": true/false,
    "confidence": 0.0-1.0,
    "answer": "brief answer if found",
    "sources": ["urls that contain the answer"]
  }
]`),
      new HumanMessage(`**Questions to Check:**
${subQueries.map(sq => sq.question).join('\n')}

**Sources:**
${sources.slice(0, SEARCH_CONFIG.MAX_SOURCES_TO_CHECK).map(s => {
        let sourceInfo = `**URL:** ${s.url}\n**Title:** ${s.title}\n`;

        // Include summary if available (this is the key insight from the search)
        if (s.summary) {
          sourceInfo += `**Summary:** ${s.summary}\n`;
        }

        // Include content preview
        if (s.content) {
          sourceInfo += `**Content:** ${s.content.slice(0, SEARCH_CONFIG.ANSWER_CHECK_PREVIEW)}\n`;
        }

        return sourceInfo;
      }).join('\n---\n')}`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      let content = response.content.toString();

      // Strip markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();

      const results = JSON.parse(content);

      // Update sub-queries with results
      return subQueries.map(sq => {
        const result = results.find((r: { question: string }) => r.question === sq.question);
        if (result && result.confidence > sq.confidence) {
          return {
            ...sq,
            answered: result.confidence >= SEARCH_CONFIG.MIN_ANSWER_CONFIDENCE,
            answer: result.answer,
            confidence: result.confidence,
            sources: [...new Set([...sq.sources, ...(result.sources || [])])]
          };
        }
        return sq;
      });
    } catch (error) {
      console.error('Error checking answers:', error);
      return subQueries;
    }
  }

  private async extractSubQueries(query: string): Promise<Array<{ question: string; searchQuery: string }>> {
    const messages = [
      new SystemMessage(`Hi! I need to break down your question into specific, answerable parts.

**My Goal:** Extract individual factual questions that can be definitively answered.

**Important Rules:**
🔍 When you mention something with a version/number (like "deepseek r1 0528"), I'll include the FULL version in the question
🔍 For search queries, I can simplify slightly but keep key identifiers

**Examples:**

**"Who founded Anthropic and when"** →
[
  {"question": "Who founded Anthropic?", "searchQuery": "Anthropic founders"},
  {"question": "When was Anthropic founded?", "searchQuery": "Anthropic founded date year"}
]

**"What is OpenAI's Q3 2024 revenue and who is their VP of Infrastructure"** →
[
  {"question": "What was OpenAI's Q3 2024 revenue?", "searchQuery": "OpenAI Q3 2024 revenue earnings"},
  {"question": "Who is OpenAI's VP of Infrastructure?", "searchQuery": "OpenAI VP Infrastructure executive team"}
]

**"Tell me about Product A + Model B version 123"** →
[
  {"question": "What is Product A?", "searchQuery": "Product A features"},
  {"question": "What is Model B version 123?", "searchQuery": "Model B"}
]

**My Guidelines:**
✅ For comparisons: Create one question/search covering both items
✅ For model names with versions (like "R1 0528"): Treat as single entity, but search main product name
✅ Keep it reasonable: aim for 3-5 questions max

**Format:** Return ONLY a JSON array of {question, searchQuery} objects.`),
      new HumanMessage(`Your question: "${query}"`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      return JSON.parse(response.content.toString());
    } catch {
      // Fallback: treat as single query
      return [{ question: query, searchQuery: query }];
    }
  }

  // This method was removed as it's not used in the current implementation
  // Search queries are now generated from sub-queries in the plan node

  private async generateAlternativeSearchQueries(
    subQueries: Array<{ question: string; searchQuery: string; answered: boolean; answer?: string; confidence: number; sources: string[] }>,
    previousAttempts: number
  ): Promise<string[]> {
    const unansweredQueries = subQueries.filter(sq => !sq.answered || sq.confidence < SEARCH_CONFIG.MIN_ANSWER_CONFIDENCE);

    // If we're on attempt 3 and still searching for the same thing, just give up on that specific query
    if (previousAttempts >= 2) {
      const problematicQueries = unansweredQueries.filter(sq => {
        // Check if the question contains a version number or specific identifier that might not exist
        const hasVersionPattern = /\b\d{3,4}\b|\bv\d+\.\d+|\bversion\s+\d+/i.test(sq.question);
        const hasFailedMultipleTimes = previousAttempts >= 2;
        return hasVersionPattern && hasFailedMultipleTimes;
      });

      if (problematicQueries.length > 0) {
        // Return generic searches that might find partial info
        return problematicQueries.map(sq => {
          const baseTerm = sq.question.replace(/0528|specific version/gi, '').trim();
          return baseTerm.substring(0, 50); // Keep it short
        });
      }
    }

    const messages = [
      new SystemMessage(`${this.getCurrentDateContext()}

Generate ALTERNATIVE search queries for questions that weren't answered in previous attempts.

Previous search attempts: ${previousAttempts}
Previous queries that didn't find answers:
${unansweredQueries.map(sq => `- Question: "${sq.question}"\n  Previous search: "${sq.searchQuery}"`).join('\n')}

IMPORTANT: If searching for something with a specific version/date that keeps failing (like "R1 0528"), try searching for just the base product without the version.

Generate NEW search queries using these strategies:
1. Try broader or more general terms
2. Try different phrasings or synonyms
3. Remove specific qualifiers (like years or versions) if they're too restrictive
4. Try searching for related concepts that might contain the answer
5. For products that might not exist, search for the company or base product name

Examples of alternative searches:
- Original: "ModelX 2024.05" → Alternative: "ModelX latest version"
- Original: "OpenAI Q3 2024 revenue" → Alternative: "OpenAI financial results 2024"
- Original: "iPhone 15 Pro features" → Alternative: "latest iPhone specifications"

Return one alternative search query per unanswered question, one per line.`),
      new HumanMessage(`Generate alternative searches for these ${unansweredQueries.length} unanswered questions.`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      const result = response.content.toString();

      const queries = result
        .split('\n')
        .map(q => q.trim())
        .map(q => q.replace(/^["']|["']$/g, ''))
        .map(q => q.replace(/^\d+\.\s*/, ''))
        .map(q => q.replace(/^[-*#]\s*/, ''))
        .filter(q => q.length > 0)
        .filter(q => !q.match(/^```/))
        .filter(q => q.length > 3);

      return queries.slice(0, SEARCH_CONFIG.MAX_SEARCH_QUERIES);
    } catch {
      // Fallback: return original queries with slight modifications
      return unansweredQueries.map(sq => sq.searchQuery + " news reports").slice(0, SEARCH_CONFIG.MAX_SEARCH_QUERIES);
    }
  }

  private scoreContent(content: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ');
    const contentLower = content.toLowerCase();

    let score = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) score += 0.2;
    }

    return Math.min(score, 1);
  }

  private async summarizeContent(content: string, query: string): Promise<string> {
    try {
      const messages = [
        new SystemMessage(`${this.getCurrentDateContext()}

You are a senior research analyst. Your task is to extract a single, concise, and highly relevant key finding from the provided text that directly answers the user's search query.

**CRITICAL INSTRUCTIONS:**
1.  **Focus on Relevance:** Your primary goal is to find the piece of information that is most relevant to the query: "${query}". Ignore everything else.
2.  **Be Concise:** Return only ONE single sentence.
3.  **Be Specific:** Include concrete data, numbers, names, or facts when available.
4.  **Ignore Noise:** Discard irrelevant content like navigation menus, ads, social media comments, author bios, and other boilerplate text. Do NOT summarize metadata.
5.  **No Excuses:** If the text is messy, do your best. If you cannot find a perfect answer, return the most relevant factual statement you can find. Do not state that you couldn't find information.

**Example:**
-   If the query is "breakthroughs in AI safety" and the text contains a sentence about a new safety model, extract that.
-   If the query is "Claude 3.5 Sonnet release date" and the text mentions "was released on June 20, 2024", extract that.

Provide only the single-sentence summary.`),
        new HumanMessage(`Query: "${query}"\n\nContent to Analyze:\n"""\n${content.slice(0, 5000)}\n"""`)
      ];

      const response = await this.llm.invoke(messages);
      return response.content.toString().trim();
    } catch {
      return '';
    }
  }

  private async generateStreamingAnswer(
    query: string,
    sources: Source[],
    onChunk: (chunk: string) => void,
    context?: { query: string; response: string }[]
  ): Promise<string> {
    // Optimize source processing for speed
    const optimizedSources = sources
      .filter(s => s.content || s.summary) // Only sources with content
      .sort((a, b) => (b.quality || 0) - (a.quality || 0)) // Best quality first
      .slice(0, SEARCH_CONFIG.MAX_SOURCES_TO_CHECK) // Limit number of sources
      .map((s, i) => {
        // Prefer summary over full content for speed
        if (s.summary && s.summary.length > 20) {
          return `[${i + 1}] ${s.title}\n${s.summary}`;
        }
        // Truncate very long content for faster processing
        const content = s.content || '';
        const truncatedContent = content.length > 1500 ? content.slice(0, 1500) + '...' : content;
        return `[${i + 1}] ${s.title}\n${truncatedContent}`;
      })
      .join('\n\n');

    let contextPrompt = '';
    if (context && context.length > 0) {
      contextPrompt = '\n\nPrevious conversation:\n';
      context.slice(-2).forEach(c => { // Only last 2 conversations for speed
        contextPrompt += `You: ${c.query}\nMe: ${c.response.substring(0, 150)}...\n\n`;
      });
    }

    const messages = [
      new SystemMessage(`${this.getCurrentDateContext()}

You are an expert research assistant who writes comprehensive, engaging, and naturally flowing responses. Your goal is to provide thorough, well-organized answers that read like they were written by a knowledgeable human expert.

**Writing Style:**
✅ Write in a natural, conversational tone as if explaining to an intelligent colleague
✅ Use smooth transitions between ideas and paragraphs
✅ Provide comprehensive coverage with logical flow
✅ Include specific details, examples, and context
✅ Weave citations naturally into the narrative: "According to [1]..." or "Research from [2] shows..."
✅ Use varied sentence structures and engaging language

**Organization Guidelines:**
- Start with a clear, direct answer to the main question
- Develop key themes in separate, well-structured paragraphs
- Use subheadings (##) only when they truly enhance readability
- Include relevant background context and implications
- End with practical insights or broader significance

**Content Requirements:**
✅ Be thorough and comprehensive - aim for 300-800 words depending on complexity
✅ Include specific facts, numbers, dates, and examples from sources
✅ Explain technical concepts clearly without being condescending
✅ Address different aspects and perspectives of the topic
✅ Provide context about why this information matters

**Important:** Write as a cohesive, flowing article rather than disconnected bullet points. Make it engaging and informative while maintaining accuracy and proper citations.`),
      new HumanMessage(`**Question:** "${query}"${contextPrompt}

**Sources:**
${optimizedSources}`)
    ];

    let fullText = '';

    try {
      // Use fast model for speed when FAST_SYNTHESIS is enabled
      const modelToUse = SEARCH_CONFIG.FAST_SYNTHESIS ? this.llm : this.streamingLlm;
      const stream = await modelToUse.stream(messages);

      for await (const chunk of stream) {
        const content = chunk.content;
        if (typeof content === 'string') {
          fullText += content;
          onChunk(content);
        }
      }
    } catch {
      // Fallback to non-streaming if streaming fails
      const modelToUse = SEARCH_CONFIG.FAST_SYNTHESIS ? this.llm : this.streamingLlm;
      const response = await modelToUse.invoke(messages);
      fullText = response.content.toString();
      onChunk(fullText);
    }

    return fullText;
  }

  private async generateFollowUpQuestions(
    originalQuery: string,
    answer: string,
    _sources: Source[],
    context?: { query: string; response: string }[]
  ): Promise<string[]> {
    try {
      let contextPrompt = '';
      if (context && context.length > 0) {
        contextPrompt = '\n\nPrevious conversation topics:\n';
        context.forEach(c => {
          contextPrompt += `- ${c.query}\n`;
        });
        contextPrompt += '\nConsider the full conversation flow when generating follow-ups.\n';
      }

      const messages = [
        new SystemMessage(`${this.getCurrentDateContext()}

You are a thoughtful research assistant generating engaging follow-up questions. Based on the comprehensive answer I just provided, suggest natural questions that would help the user explore the topic more deeply.

**My Goal:** Generate 3 compelling follow-up questions that feel like natural next steps in a conversation.

**What Makes Great Follow-ups:**
✅ Build naturally on the information just shared
✅ Explore different dimensions or practical applications  
✅ Feel conversational and genuinely curious
✅ Help users discover new angles they might not have considered
✅ Are specific enough to be actionable
✅ Stay under 75 characters for clean display

**Question Types to Consider:**
- Practical applications: "How can this be implemented in practice?"
- Comparisons: "How does this compare to alternative approaches?"
- Deeper exploration: "What are the long-term implications of this?"
- Related topics: "What role does [related concept] play in this?"
- Real-world examples: "Can you show examples of this in action?"
- Future trends: "How is this expected to evolve?"

**Important Guidelines:**
- Make each question distinct and valuable
- Ensure questions feel like natural conversation flow
- Consider the user's likely knowledge level and interests
- Only include time-sensitive questions if the original query was about current events

**Format:** Return exactly 3 questions, one per line, no numbering or formatting.`),
        new HumanMessage(`**User's Original Question:** "${originalQuery}"

**My Comprehensive Answer:** ${answer.length > 1200 ? answer.slice(0, 1200) + '...' : answer}${contextPrompt}`)
      ];

      const response = await this.llm.invoke(messages);
      const questions = response.content.toString()
        .split('\n')
        .map(q => q.trim())
        .filter(q => q.length > 0 && q.length < 75)
        .slice(0, 3);

      return questions.length > 0 ? questions : [];
    } catch {
      return [];
    }
  }

  /**
   * Get available model providers
   */
  static getAvailableProviders(): ModelProvider[] {
    return Object.keys(MODEL_CONFIGS) as ModelProvider[];
  }

  /**
   * Create search engine with specific provider
   */
  static create(
    firecrawl: FirecrawlClient,
    provider: ModelProvider,
    options?: { enableCheckpointing?: boolean }
  ): LangGraphSearchEngine {
    return new LangGraphSearchEngine(firecrawl, {
      ...options,
      modelProvider: provider,
    });
  }

  /**
   * Check if provider is available (has required API key)
   */
  static isProviderAvailable(provider: ModelProvider): boolean {
    switch (provider) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY;
      case 'gemini':
        return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      default:
        return false;
    }
  }
}