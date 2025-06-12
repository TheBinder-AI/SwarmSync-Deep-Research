import { NextResponse } from 'next/server';
import { LangGraphSearchEngine } from '@/lib/langgraph-search-engine';
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export async function GET() {
    try {
        // Get available providers using the static method
        const allProviders = LangGraphSearchEngine.getAvailableProviders();

        // Test each provider with actual API calls
        const available = [];
        const providerStatus: Record<string, { available: boolean; error?: string }> = {};

        for (const provider of allProviders) {
            try {
                if (provider === 'openai' && process.env.OPENAI_API_KEY) {
                    // Test OpenAI API key
                    const testLlm = new ChatOpenAI({
                        modelName: 'gpt-4o-mini',
                        temperature: 0,
                        openAIApiKey: process.env.OPENAI_API_KEY,
                        maxTokens: 10,
                    });
                    await testLlm.invoke([{ role: 'user', content: 'test' }]);
                    available.push(provider);
                    providerStatus[provider] = { available: true };
                } else if (provider === 'gemini' && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
                    // Test Gemini API key
                    const testLlm = new ChatGoogleGenerativeAI({
                        model: 'gemini-1.5-flash',
                        temperature: 0,
                        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
                        maxOutputTokens: 10,
                    });
                    await testLlm.invoke([{ role: 'user', content: 'test' }]);
                    available.push(provider);
                    providerStatus[provider] = { available: true };
                } else {
                    providerStatus[provider] = {
                        available: false,
                        error: 'API key not set in environment variables'
                    };
                }
            } catch (error) {
                providerStatus[provider] = {
                    available: false,
                    error: error instanceof Error ? error.message : 'Unknown error testing API key'
                };
            }
        }

        // Check if Firecrawl API key is available
        const hasFirecrawlKey = !!process.env.FIRECRAWL_API_KEY;

        // If no AI providers are available, return the first one that exists as a fallback
        const defaultProvider = available.length > 0 ? available[0] : 'openai';

        return NextResponse.json({
            available,
            default: defaultProvider,
            all: allProviders,
            hasFirecrawlKey,
            providerStatus
        });
    } catch (error) {
        console.error('Error checking providers:', error);

        // Fallback response
        return NextResponse.json({
            available: ['openai'], // Default fallback
            default: 'openai',
            all: ['openai', 'gemini'],
            hasFirecrawlKey: !!process.env.FIRECRAWL_API_KEY,
            providerStatus: {
                openai: { available: false, error: 'Failed to test API key' },
                gemini: { available: false, error: 'Failed to test API key' }
            },
            error: 'Failed to check providers'
        });
    }
} 