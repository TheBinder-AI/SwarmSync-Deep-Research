import { LangGraphSearchEngine, ModelProvider } from './langgraph-search-engine';
import { FirecrawlClient } from './firecrawl';

// Example usage of different model providers

async function createSearchEngineWithProvider(provider: ModelProvider) {
    // Check if provider is available
    if (!LangGraphSearchEngine.isProviderAvailable(provider)) {
        console.error(`${provider.toUpperCase()} provider is not available. Please check your API key.`);
        return null;
    }

    // Initialize Firecrawl (you'll need to set FIRECRAWL_API_KEY)
    const firecrawl = new FirecrawlClient(process.env.FIRECRAWL_API_KEY!);

    // Create search engine with specific provider
    const engine = LangGraphSearchEngine.create(firecrawl, provider, {
        enableCheckpointing: true
    });

    console.log(`Created search engine with ${provider} provider`);
    console.log(`Current provider: ${engine.getModelProvider()}`);

    return engine;
}

// Example: Using OpenAI
async function useOpenAI() {
    const engine = await createSearchEngineWithProvider('openai');
    if (!engine) return;

    // Your search logic here
    await engine.search(
        "What are the latest developments in AI?",
        (event) => {
            console.log('OpenAI Event:', event.type, event);
        }
    );
}

// Example: Using Gemini
async function useGemini() {
    const engine = await createSearchEngineWithProvider('gemini');
    if (!engine) return;

    // Your search logic here
    await engine.search(
        "Explain quantum computing developments in 2024",
        (event) => {
            console.log('Gemini Event:', event.type, event);
        }
    );
}

// Example: Switching between providers
async function switchProviders() {
    const firecrawl = new FirecrawlClient(process.env.FIRECRAWL_API_KEY!);

    // Start with OpenAI
    const engine = new LangGraphSearchEngine(firecrawl, {
        modelProvider: 'openai'
    });

    console.log(`Starting with: ${engine.getModelProvider()}`);

    // Switch to Gemini if available
    if (LangGraphSearchEngine.isProviderAvailable('gemini')) {
        await engine.switchModelProvider('gemini');
        console.log(`Switched to: ${engine.getModelProvider()}`);
    }
}

// Example: Check all available providers
function checkAvailableProviders() {
    const providers = LangGraphSearchEngine.getAvailableProviders();
    console.log('Available providers:', providers);

    providers.forEach(provider => {
        const isAvailable = LangGraphSearchEngine.isProviderAvailable(provider);
        console.log(`${provider}: ${isAvailable ? 'Available' : 'Not available (missing API key)'}`);
    });
}

// Export functions for use
export {
    createSearchEngineWithProvider,
    useOpenAI,
    useGemini,
    switchProviders,
    checkAvailableProviders
};

// Environment variables needed:
// - OPENAI_API_KEY (for OpenAI provider)
// - GOOGLE_GENERATIVE_AI_API_KEY (for Gemini provider)
// - FIRECRAWL_API_KEY (for web scraping) 