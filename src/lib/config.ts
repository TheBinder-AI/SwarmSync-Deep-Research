// Search Engine Configuration
export const SEARCH_CONFIG = {
  // Search Settings
  MAX_SEARCH_QUERIES: 3,         // Increased from 2 - more queries for better coverage
  MAX_SOURCES_PER_SEARCH: 8,     // Increased from 4 - more sources per search
  MAX_SOURCES_TO_SCRAPE: 10,     // Increased from 3 - more comprehensive scraping

  // Content Processing
  MIN_CONTENT_LENGTH: 100,       // Minimum content length to consider valid
  SUMMARY_CHAR_LIMIT: 80,        // Reduced from 100 - shorter summaries
  CONTEXT_PREVIEW_LENGTH: 300,   // Reduced from 500 - less context processing
  ANSWER_CHECK_PREVIEW: 1500,    // Reduced from 2500 - less content to analyze
  MAX_SOURCES_TO_CHECK: 15,      // Increased from 6 - more sources to analyze for better research

  // Retry Logic - MAJOR SPEED IMPROVEMENTS
  MAX_RETRIES: 1,                // Reduced from 2 - fewer retries
  MAX_SEARCH_ATTEMPTS: 2,        // Increased from 1 - allow one retry for better results
  MIN_ANSWER_CONFIDENCE: 0.2,    // Reduced from 0.3 - accept partial answers
  EARLY_TERMINATION_CONFIDENCE: 0.6, // Reduced from 0.8 - terminate early

  // Timeouts
  SCRAPE_TIMEOUT: 8000,          // Reduced from 15000 - faster timeout

  // Performance - SPEED OPTIMIZATIONS
  SOURCE_ANIMATION_DELAY: 25,    // Reduced from 50 - faster animations
  PARALLEL_SUMMARY_GENERATION: true, // Keep parallel processing
  SPEED_MODE: true,              // Enable all speed optimizations
  FAST_SYNTHESIS: true,          // Use fast model for everything
} as const;

// You can also export individual configs for different components
export const UI_CONFIG = {
  ANIMATION_DURATION: 300,       // Default animation duration (ms)
  SOURCE_FADE_DELAY: 50,         // Delay between source animations (ms)
  MESSAGE_CYCLE_DELAY: 2000,     // Delay for cycling through messages (ms)
} as const;

// Model provider type
export type ModelProvider = 'openai' | 'gemini';

// Model Configuration
export const MODEL_CONFIG = {
  // Default provider (can be overridden) - will be auto-detected
  DEFAULT_PROVIDER: "auto" as ModelProvider | "auto",

  // OpenAI Configuration
  OPENAI: {
    FAST_MODEL: "gpt-4o-mini",     // Fast model for quick operations
    QUALITY_MODEL: "gpt-4o",       // High-quality model for final synthesis
    TEMPERATURE: 0,                // Model temperature (0 = deterministic)
  },

  // Gemini Configuration  
  GEMINI: {
    FAST_MODEL: "gemini-2.0-flash-exp",     // Fast model for quick operations
    QUALITY_MODEL: "gemini-2.0-flash-thinking-exp",    // High-quality model for final synthesis
    TEMPERATURE: 0,                     // Model temperature (0 = deterministic)
  },

  // Legacy support (backwards compatibility)
  FAST_MODEL: "gpt-4o-mini",     // Fast model for quick operations
  QUALITY_MODEL: "gpt-4o",       // High-quality model for final synthesis
  TEMPERATURE: 0,                // Model temperature (0 = deterministic)
} as const;

// Model provider configurations
export const MODEL_PROVIDERS = {
  openai: {
    provider: 'openai' as ModelProvider,
    fastModel: MODEL_CONFIG.OPENAI.FAST_MODEL,
    qualityModel: MODEL_CONFIG.OPENAI.QUALITY_MODEL,
    temperature: MODEL_CONFIG.OPENAI.TEMPERATURE,
  },
  gemini: {
    provider: 'gemini' as ModelProvider,
    fastModel: MODEL_CONFIG.GEMINI.FAST_MODEL,
    qualityModel: MODEL_CONFIG.GEMINI.QUALITY_MODEL,
    temperature: MODEL_CONFIG.GEMINI.TEMPERATURE,
  },
} as const;