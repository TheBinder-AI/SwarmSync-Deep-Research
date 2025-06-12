'use client';

import { useState, useEffect } from 'react';
import { Button } from './button';
import Image from 'next/image';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "./dialog";

export type ModelProvider = 'openai' | 'gemini';

interface ModelSelectorProps {
    selectedProvider: ModelProvider;
    onProviderChange: (provider: ModelProvider) => void;
    disabled?: boolean;
}

// Model provider configurations for display
const MODEL_PROVIDERS = {
    openai: {
        name: 'ChatGPT',
        description: 'OpenAI GPT-4o & GPT-4o-mini',
        icon: '/openai.svg',
        color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        available: false,
    },
    gemini: {
        name: 'Gemini',
        description: 'Google Gemini 2.0 Flash',
        icon: '/gemini-color.svg',
        color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        available: false,
    },
};

export function ModelSelector({ selectedProvider, onProviderChange, disabled = false }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showUnavailableInfo, setShowUnavailableInfo] = useState(false);

    // Check available providers on mount
    useEffect(() => {
        const checkProviders = async () => {
            try {
                const response = await fetch('/api/check-providers');
                const data = await response.json();

                // Update availability in display config
                MODEL_PROVIDERS.openai.available = data.available.includes('openai');
                MODEL_PROVIDERS.gemini.available = data.available.includes('gemini');
            } catch (error) {
                console.error('Failed to check providers:', error);
            }
        };

        checkProviders();
    }, []);

    const handleProviderSelect = (provider: ModelProvider) => {
        if (MODEL_PROVIDERS[provider].available) {
            onProviderChange(provider);
            setIsOpen(false);
        } else {
            setShowUnavailableInfo(true);
        }
    };

    const currentProvider = MODEL_PROVIDERS[selectedProvider];

    return (
        <>
            {/* Model Selector Button */}
            <Button
                variant="outline"
                onClick={() => setIsOpen(true)}
                disabled={disabled}
                className="h-10 px-3 rounded-full border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
                <Image
                    src={currentProvider.icon}
                    alt={currentProvider.name}
                    width={20}
                    height={20}
                    className="mr-2"
                />
                <span className="text-sm font-medium">{currentProvider.name}</span>
                <svg
                    className="w-4 h-4 ml-2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </Button>

            {/* Model Selection Dialog */}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                    <DialogHeader>
                        <DialogTitle>Choose AI Model</DialogTitle>
                        <DialogDescription>
                            Select which AI model you'd like to use for search and analysis.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3 py-4">
                        {Object.entries(MODEL_PROVIDERS).map(([key, provider]) => {
                            const providerKey = key as ModelProvider;
                            const isSelected = selectedProvider === providerKey;
                            const isAvailable = provider.available;

                            return (
                                <button
                                    key={key}
                                    onClick={() => handleProviderSelect(providerKey)}
                                    disabled={!isAvailable}
                                    className={`
                    w-full p-4 rounded-lg border text-left transition-all duration-200
                    ${isSelected
                                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20'
                                            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                                        }
                    ${!isAvailable
                                            ? 'opacity-50 cursor-not-allowed'
                                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                        }
                  `}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <Image
                                                src={provider.icon}
                                                alt={provider.name}
                                                width={32}
                                                height={32}
                                                className="flex-shrink-0"
                                            />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold text-base">{provider.name}</h3>
                                                    {isSelected && (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                                                    {provider.description}
                                                </p>
                                                {!isAvailable && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                        API key not configured
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {isSelected && (
                                            <svg className="w-5 h-5 text-orange-500 mt-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex justify-end">
                        <Button variant="outline" onClick={() => setIsOpen(false)}>
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Unavailable Provider Info Dialog */}
            <Dialog open={showUnavailableInfo} onOpenChange={setShowUnavailableInfo}>
                <DialogContent className="sm:max-w-[500px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                    <DialogHeader>
                        <DialogTitle>API Key Required</DialogTitle>
                        <DialogDescription>
                            To use this AI model, you need to configure the appropriate API key.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                            <h4 className="font-semibold text-amber-800 dark:text-amber-200">Required Environment Variables:</h4>
                            <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                                <li>• <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">OPENAI_API_KEY</code> for ChatGPT/OpenAI</li>
                                <li>• <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GOOGLE_GENERATIVE_AI_API_KEY</code> for Gemini</li>
                            </ul>
                        </div>

                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            Set these environment variables in your deployment or .env.local file to enable additional AI models.
                        </p>
                    </div>

                    <div className="flex justify-end">
                        <Button variant="outline" onClick={() => setShowUnavailableInfo(false)}>
                            Got it
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
} 