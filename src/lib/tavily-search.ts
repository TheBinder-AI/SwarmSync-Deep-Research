import { SearchEvent, Source } from './langgraph-search-engine';
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface TavilySearchOptions {
    apiKey: string;
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeAnswer?: boolean;
    includeRawContent?: boolean;
    excludeDomains?: string[];
    includeDomains?: string[];
}

export interface TavilyResult {
    title: string;
    url: string;
    content: string;
    raw_content?: string;
    score: number;
}

export interface TavilyResponse {
    answer?: string;
    query: string;
    follow_up_questions?: string[];
    results: TavilyResult[];
    response_time: number;
}

export class TavilySearchEngine {
    private apiKey: string;
    private baseUrl = 'https://api.tavily.com';
    private llm: ChatOpenAI | ChatGoogleGenerativeAI;

    constructor(apiKey: string, modelProvider: 'openai' | 'gemini' = 'openai') {
        this.apiKey = apiKey;

        // Initialize LLM for answer generation
        if (modelProvider === 'gemini' && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            this.llm = new ChatGoogleGenerativeAI({
                model: "gemini-1.5-flash",
                temperature: 0,
                apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            });
        } else if (process.env.OPENAI_API_KEY) {
            this.llm = new ChatOpenAI({
                model: "gpt-4o-mini",
                temperature: 0,
            });
        } else {
            throw new Error('No API key found for LLM. Set OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY');
        }
    }

    async search(
        query: string,
        onEvent: (event: SearchEvent) => void,
        context?: { query: string; response: string }[],
        options?: Partial<TavilySearchOptions>
    ): Promise<void> {
        const searchOptions: TavilySearchOptions = {
            apiKey: this.apiKey,
            maxResults: 15,
            searchDepth: 'advanced',
            includeAnswer: true,
            includeRawContent: false,
            ...options
        };

        try {
            // Phase 1: Understanding
            onEvent({
                type: 'phase-update',
                phase: 'understanding',
                message: 'Analyzing your question...'
            });

            onEvent({
                type: 'thinking',
                message: '🚀 Using Tavily AI for lightning-fast comprehensive search'
            });

            // Phase 2: Searching (much faster with Tavily)
            onEvent({
                type: 'phase-update',
                phase: 'searching',
                message: 'Searching across the web with AI...'
            });

            const searchPayload = {
                query,
                max_results: searchOptions.maxResults,
                search_depth: searchOptions.searchDepth,
                include_answer: searchOptions.includeAnswer,
                include_raw_content: searchOptions.includeRawContent,
                exclude_domains: searchOptions.excludeDomains,
                include_domains: searchOptions.includeDomains
            };

            const response = await fetch(`${this.baseUrl}/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(searchPayload)
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorJson = await response.json();
                    throw new Error(`Tavily API error: ${response.status} - ${errorJson.error || JSON.stringify(errorJson)}`);
                } else {
                    const errorText = await response.text();
                    throw new Error(`Tavily API error: ${response.status} - ${errorText.slice(0, 100)}...`);
                }
            }

            const data: TavilyResponse = await response.json();

            // Convert Tavily results to our Source format
            const sources: Source[] = data.results.map(result => ({
                url: result.url,
                title: result.title,
                content: result.content,
                summary: result.content.length > 300 ? result.content.substring(0, 300) + '...' : result.content,
                quality: result.score
            }));

            // Emit found sources
            onEvent({
                type: 'found',
                sources,
                query
            });

            // Phase 3: Quick processing (no complex analysis needed)
            onEvent({
                type: 'phase-update',
                phase: 'analyzing',
                message: 'Processing high-quality sources...'
            });

            onEvent({
                type: 'thinking',
                message: `✅ Found ${sources.length} premium sources with relevance scores: ${sources.map(s => (s.quality || 0).toFixed(2)).join(', ')}`
            });

            // Phase 4: Generate comprehensive answer using LLM
            onEvent({
                type: 'phase-update',
                phase: 'synthesizing',
                message: 'Generating comprehensive answer...'
            });

            const finalAnswer = await this.generateStreamingAnswer(query, sources, context, onEvent);

            // Generate follow-up questions
            const followUpQuestions = data.follow_up_questions || await this.generateFollowUpQuestions(query, finalAnswer, sources);

            // Final result
            onEvent({
                type: 'final-result',
                content: finalAnswer,
                sources,
                followUpQuestions
            });

            onEvent({
                type: 'phase-update',
                phase: 'complete',
                message: `🎉 Search completed in ${data.response_time}ms!`
            });

        } catch (error) {
            console.error('Tavily search error:', error);
            onEvent({
                type: 'error',
                error: error instanceof Error ? error.message : 'Search failed',
                errorType: 'search'
            });
        }
    }

    private async generateStreamingAnswer(
        query: string,
        sources: Source[],
        context?: { query: string; response: string }[],
        onEvent?: (event: SearchEvent) => void
    ): Promise<string> {
        // Prepare context
        let contextPrompt = '';
        if (context && context.length > 0) {
            contextPrompt = '\n\nPrevious conversation:\n';
            context.slice(-2).forEach(c => {
                contextPrompt += `You: ${c.query}\nMe: ${c.response.substring(0, 150)}...\n\n`;
            });
        }

        // Prepare sources
        const sourcesText = sources
            .slice(0, 4) // Use top 4 sources for speed
            .map((source, index) => {
                return `[${index + 1}] ${source.title}\n${source.content}`;
            })
            .join('\n\n');

        const messages = [
            new SystemMessage(`You are an expert research assistant who writes comprehensive, engaging, and naturally flowing responses. Your goal is to provide thorough, well-organized answers that read like they were written by a knowledgeable human expert.

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
${sourcesText}`)
        ];

        let fullText = '';

        try {
            // Stream the response
            const stream = await this.llm.stream(messages);

            for await (const chunk of stream) {
                const content = chunk.content;
                if (typeof content === 'string') {
                    fullText += content;
                    if (onEvent) {
                        onEvent({
                            type: 'content-chunk',
                            chunk: content
                        });
                    }
                }
            }
        } catch (error) {
            // Fallback to non-streaming
            const response = await this.llm.invoke(messages);
            fullText = response.content.toString();
            if (onEvent) {
                onEvent({
                    type: 'content-chunk',
                    chunk: fullText
                });
            }
        }

        return fullText;
    }

    private async generateFollowUpQuestions(
        query: string,
        answer: string,
        sources: Source[]
    ): Promise<string[]> {
        try {
            const messages = [
                new SystemMessage(`You are a thoughtful research assistant generating engaging follow-up questions. Based on the comprehensive answer I just provided, suggest natural questions that would help the user explore the topic more deeply.

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
                new HumanMessage(`**User's Original Question:** "${query}"

**My Comprehensive Answer:** ${answer.length > 1200 ? answer.slice(0, 1200) + '...' : answer}`)
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

    static isAvailable(): boolean {
        return !!process.env.TAVILY_API_KEY;
    }

    static getApiKey(): string | undefined {
        return process.env.TAVILY_API_KEY;
    }
} 