'use client';

import { useState, useEffect, useRef } from 'react';
import { search } from './search';
import { readStreamableValue } from 'ai/rsc';
import { SearchDisplay } from './search-display';
import { SearchEvent, Source } from '@/lib/langgraph-search-engine';
import { MarkdownRenderer } from './markdown-renderer';
import { CitationTooltip } from './citation-tooltip';
import Image from 'next/image';
import { getFaviconUrl, getDefaultFavicon, markFaviconFailed } from '@/lib/favicon-utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ModelSelector, type ModelProvider } from "@/components/ui/model-selector";

const FALLBACK_QUERIES = [
  "What is Claude 3.5 Sonnet and how does it compare to GPT-4o?",
  "Explain OpenAI's o3 reasoning model and its breakthrough capabilities"
];

export function Chat() {
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [messages, setMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: React.ReactNode;
    isSearch: boolean;
    searchResults?: string;
    sources?: Source[];
  }>>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasFirecrawlKey, setHasFirecrawlKey] = useState(false);
  const [firecrawlApiKey, setFirecrawlApiKey] = useState('');
  const [showApiInput, setShowApiInput] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selectedModelProvider, setSelectedModelProvider] = useState<ModelProvider>('openai');
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>(FALLBACK_QUERIES);
  const [lastSuggestionUpdate, setLastSuggestionUpdate] = useState<string>('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const handleSelectSuggestion = (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
    // Focus the input to ensure it's ready
    setTimeout(() => {
      const inputElement = document.querySelector('input[type="text"]') as HTMLInputElement;
      if (inputElement) {
        inputElement.focus();
      }
    }, 100);
  };

  // Fetch AI trends and generate suggestions
  const fetchAITrendSuggestions = async () => {
    try {
      const today = new Date().toDateString();

      // Check if we already have suggestions for today
      const storedData = localStorage.getItem('aiTrendSuggestions');
      if (storedData) {
        const { date, suggestions } = JSON.parse(storedData);
        if (date === today && suggestions && suggestions.length > 0) {
          setDynamicSuggestions(suggestions);
          setLastSuggestionUpdate(date);
          return;
        }
      }

      // Fetch new suggestions
      const response = await fetch('/api/generate-suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: selectedModelProvider,
          fallback: FALLBACK_QUERIES
        })
      });

      if (response.ok) {
        const { suggestions } = await response.json();
        if (suggestions && suggestions.length > 0) {
          setDynamicSuggestions(suggestions);
          setLastSuggestionUpdate(today);

          // Store in localStorage
          localStorage.setItem('aiTrendSuggestions', JSON.stringify({
            date: today,
            suggestions
          }));
        } else {
          setDynamicSuggestions(FALLBACK_QUERIES);
        }
      } else {
        console.warn('Failed to fetch AI trend suggestions, using fallback');
        setDynamicSuggestions(FALLBACK_QUERIES);
      }
    } catch (error) {
      console.error('Error fetching AI trend suggestions:', error);
      setDynamicSuggestions(FALLBACK_QUERIES);
    }
  };

  // Check for environment variables on mount
  useEffect(() => {
    const checkEnvironment = async () => {
      try {
        const response = await fetch('/api/check-providers');
        const data = await response.json();

        if (data.available && data.available.length > 0) {
          setHasApiKey(true);
          // Set to first available provider if current selection is not available
          if (!data.available.includes(selectedModelProvider)) {
            setSelectedModelProvider(data.available[0]);
          }
        } else {
          setHasApiKey(false);

          // Show detailed error information
          if (data.providerStatus) {
            console.log('Provider status:', data.providerStatus);

            // Show a message with specific error details
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: (
                <div className="p-4 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-red-700 dark:text-red-300 font-medium">API Key Issues Detected</p>
                  <div className="text-red-600 dark:text-red-400 text-sm mt-2 space-y-2">
                    {Object.entries(data.providerStatus).map(([provider, status]: [string, any]) => (
                      <div key={provider}>
                        <strong>{provider.toUpperCase()}:</strong> {status.available ? '✅ Working' : `❌ ${status.error}`}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-red-600 dark:text-red-400 text-sm">
                    <p><strong>To fix:</strong></p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Check your <code className="bg-red-100 dark:bg-red-900 px-1 rounded">.env.local</code> file</li>
                      <li>Ensure API keys are valid and not expired</li>
                      <li>For Gemini: Make sure the API key has access to the Generative AI API</li>
                      <li>Restart the development server after changing environment variables</li>
                    </ul>
                  </div>
                </div>
              ),
              isSearch: false
            }]);
          }
        }

        // Check if Firecrawl API key is available in environment
        setHasFirecrawlKey(data.hasFirecrawlKey || false);
      } catch (error) {
        console.error('Error checking environment:', error);
        setHasApiKey(false);
        setHasFirecrawlKey(false);
      }
    };

    checkEnvironment();
  }, [selectedModelProvider]);

  // Fetch AI trend suggestions when component mounts or provider changes
  useEffect(() => {
    if (hasApiKey) {
      fetchAITrendSuggestions();
    }
  }, [hasApiKey, selectedModelProvider]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const saveApiKey = () => {
    if (firecrawlApiKey.trim()) {
      setHasFirecrawlKey(true);
      setShowApiInput(false);
      toast.success('API key saved! Starting your search...');

      // Continue with the pending query
      if (input) {
        performSearch(input);
      }
    }
  };

  const handleFollowUpQuestion = async (question: string) => {
    if (isSearching) return; // Prevent multiple searches

    setInput(question);
    setShowSuggestions(false);

    // Add user message
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: question,
      isSearch: true
    }]);

    // Perform the search directly
    await performSearch(question);
  };

  const performSearch = async (question?: string) => {
    const query = question || input;

    if (!query.trim()) {
      toast.error("Please enter a question.");
      return;
    }

    setIsSearching(true);

    // Create assistant message with search display
    const assistantMsgId = (Date.now() + 1).toString();
    const events: SearchEvent[] = [];
    let collectedSources: Source[] = [];

    setMessages(prev => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      content: <SearchDisplay events={events} sources={[]} onFollowUpQuestion={handleFollowUpQuestion} />,
      isSearch: true,
      sources: []
    }]);

    try {
      // Build context from previous messages by pairing user queries with assistant responses
      const conversationContext: Array<{ query: string; response: string }> = [];

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        // Find user messages followed by assistant messages with search results
        if (msg.role === 'user' && i + 1 < messages.length) {
          const nextMsg = messages[i + 1];
          if (nextMsg.role === 'assistant' && nextMsg.searchResults) {
            conversationContext.push({
              query: msg.content as string,
              response: nextMsg.searchResults
            });
          }
        }
      }

      // Get search stream with context
      // Pass the API key only if user provided one and environment doesn't have it
      const firecrawlKey = hasFirecrawlKey ? undefined : (firecrawlApiKey || undefined);

      const { stream } = await search(query, conversationContext, firecrawlKey, selectedModelProvider);
      let finalContent = '';

      // Read stream and update events
      let streamingStarted = false;
      let contentMessageCreated = false;
      const resultMsgId = (Date.now() + 2).toString();

      // Add client-side timeout for stream reading
      const streamTimeout = setTimeout(() => {
        console.warn("⚠️ Client-side stream timeout reached");
        setIsSearching(false);
        setMessages(prev => [...prev, {
          id: (Date.now() + 3).toString(),
          role: 'assistant',
          content: 'The search is taking longer than expected. Please try again with a simpler query.',
          isSearch: true
        }]);
      }, 6 * 60 * 1000); // 6 minutes (slightly longer than server timeout)

      try {
        for await (const event of readStreamableValue(stream)) {
          // Clear timeout once we start receiving events
          if (!streamingStarted) {
            clearTimeout(streamTimeout);
            streamingStarted = true;
          }

          if (event) {
            events.push(event);

            // Collect sources as they come in
            if (event.type === 'final-result' && event.sources) {
              collectedSources = event.sources;
            }

            // Handle content streaming
            if (event.type === 'content-chunk') {
              // Don't create separate streaming messages - let SearchDisplay handle everything
            }

            // Capture final result
            if (event.type === 'final-result') {
              finalContent = event.content;
            }

            // Update the search display in real-time
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? {
                  ...msg,
                  content: <SearchDisplay
                    events={[...events]}
                    sources={collectedSources}
                    onFollowUpQuestion={handleFollowUpQuestion}
                  />,
                  sources: collectedSources
                }
                : msg
            ));
          }
        }

        // Final update with complete results
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsgId
            ? {
              ...msg,
              content: <SearchDisplay
                events={[...events]}
                sources={collectedSources}
                onFollowUpQuestion={handleFollowUpQuestion}
              />,
              searchResults: finalContent,
              sources: collectedSources
            }
            : msg
        ));
      } finally {
        clearTimeout(streamTimeout);
      }

    } catch (error) {
      console.error('Search error:', error);
      toast.error('Search failed. Please try again.');
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while searching. Please try again.',
        isSearch: true
      }]);
    } finally {
      setIsSearching(false);
      setInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSearching) return;
    setShowSuggestions(false);

    const userMessage = input;
    setInput('');

    // Check if we have required API keys
    if (!hasApiKey) {
      // AI provider API key missing - show error
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: (
          <div className="p-4 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-red-700 dark:text-red-300 font-medium">AI Provider API Key Required</p>
            <p className="text-red-600 dark:text-red-400 text-sm mt-1">
              Please set one of the following environment variables:
              <br />• <code className="bg-red-100 dark:bg-red-900 px-1 rounded">OPENAI_API_KEY</code> for ChatGPT/OpenAI
              <br />• <code className="bg-red-100 dark:bg-red-900 px-1 rounded">GOOGLE_GENERATIVE_AI_API_KEY</code> for Gemini
            </p>
          </div>
        ),
        isSearch: false
      }]);
      return;
    }

    if (!hasFirecrawlKey && !firecrawlApiKey.trim()) {
      // Firecrawl API key missing - show modal to input it
      setShowApiInput(true);

      // Still add user message to show what they asked
      const userMsgId = Date.now().toString();
      setMessages(prev => [...prev, {
        id: userMsgId,
        role: 'user',
        content: userMessage,
        isSearch: true
      }]);
      return;
    }

    // Add user message
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: userMessage,
      isSearch: true
    }]);

    // Perform the search
    await performSearch(userMessage);
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* API Key Input Modal */}
      <Dialog open={showApiInput} onOpenChange={setShowApiInput}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Firecrawl API Key Required</DialogTitle>
            <DialogDescription>
              Please enter your Firecrawl API key to enable web scraping functionality.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="Enter your Firecrawl API key"
              type="password"
              value={firecrawlApiKey}
              onChange={(e) => setFirecrawlApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveApiKey();
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowApiInput(false)}>
              Cancel
            </Button>
            <Button onClick={saveApiKey}>
              Save & Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {messages.length === 0 ? (
        // Welcome screen - compact centered layout
        <div className="flex-1 flex flex-col items-center justify-start px-6 pt-16 pb-8 max-h-screen">
          <div className="w-full max-w-4xl mx-auto flex flex-col items-center space-y-12">
            {/* Header */}
            <div className="text-center space-y-6">
              <h1 className="text-4xl font-semibold text-gray-900 dark:text-white">
                How can I help you today?
              </h1>
              <ModelSelector
                selectedProvider={selectedModelProvider}
                onProviderChange={setSelectedModelProvider}
              />
            </div>

            {/* Main input field - centered */}
            <div className="w-full max-w-3xl">
              <form onSubmit={handleSubmit} className="relative">
                <div className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask me anything..."
                    className="w-full py-4 px-6 pr-14 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-lg text-base"
                    disabled={isSearching}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isSearching}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors"
                  >
                    {isSearching ? (
                      <svg className="w-5 h-5 animate-spin text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Suggestions - compact */}
            {showSuggestions && (
              <div className="w-full max-w-4xl">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {dynamicSuggestions.slice(0, 4).map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSelectSuggestion(suggestion)}
                      className="p-3 text-left border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200"
                    >
                      <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                        {suggestion}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Messages area - Perplexity/Grok Style
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto"
          >
            <div className="max-w-4xl mx-auto px-6 py-8">
              {messages.map((msg, index) => (
                <div key={msg.id} className="mb-8">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end mb-6">
                      <div className="bg-blue-600 text-white px-4 py-3 rounded-2xl max-w-2xl">
                        <div className="text-sm opacity-90 mb-1">You</div>
                        <div>{msg.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="w-full">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 bg-gray-900 dark:bg-gray-100 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white dark:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Deep Research</span>
                        </div>
                        <div className="w-full">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Input area for conversation */}
          <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="max-w-4xl mx-auto px-6 py-4">
              <form onSubmit={handleSubmit} className="relative">
                <div className="flex items-center gap-3">
                  <ModelSelector
                    selectedProvider={selectedModelProvider}
                    onProviderChange={setSelectedModelProvider}
                  />
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask a follow-up..."
                      className="w-full py-3 px-4 pr-12 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isSearching}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || isSearching}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg flex items-center justify-center transition-colors"
                    >
                      {isSearching ? (
                        <svg className="w-4 h-4 animate-spin text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}