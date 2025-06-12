import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

export async function POST(request: NextRequest) {
    try {
        const { provider, fallback } = await request.json();

        // Get the appropriate model
        let model;
        switch (provider) {
            case 'openai':
                if (!process.env.OPENAI_API_KEY) {
                    throw new Error('OpenAI API key not available');
                }
                model = openai('gpt-4o-mini');
                break;
            case 'gemini':
                if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
                    throw new Error('Gemini API key not available');
                }
                model = google('gemini-1.5-flash');
                break;
            default:
                throw new Error('Unsupported provider');
        }

        const currentDate = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const result = await generateText({
            model,
            prompt: `Today is ${currentDate}. Generate exactly 2 engaging search questions about the latest AI trends and breakthroughs that users would be curious about right now.

**Focus on:**
✅ Recent AI model releases (last 2-3 months)
✅ Major AI company announcements 
✅ Breakthrough AI research or capabilities
✅ New AI applications or use cases
✅ AI safety or policy developments
✅ Competition between AI companies

**Guidelines:**
- Each question should be 50-80 characters
- Make them specific and engaging
- Focus on what's trending NOW in AI
- Avoid generic questions
- Include company names or specific model names when relevant

**Examples of good questions:**
- "How does Meta's Llama 3.3 compare to OpenAI's latest models?"
- "What are the key features of Google's Gemini 2.0 Flash?"
- "What is Anthropic's new computer use capability?"

**Format:** Return EXACTLY 2 questions, one per line, no numbering or bullets.`,
            temperature: 0.7,
            maxTokens: 200,
        });

        const questions = result.text
            .split('\n')
            .map(q => q.trim())
            .filter(q => q.length > 0 && q.length <= 80)
            .slice(0, 2);

        // Fallback if we don't get exactly 2 questions
        if (questions.length !== 2) {
            return NextResponse.json({ suggestions: fallback });
        }

        return NextResponse.json({ suggestions: questions });
    } catch (error) {
        console.error('Error generating suggestions:', error);

        // Get fallback from request or use defaults
        const { fallback } = await request.json().catch(() => ({}));
        const defaultFallback = [
            "What is Claude 3.5 Sonnet and how does it compare to GPT-4o?",
            "Explain OpenAI's o3 reasoning model and its breakthrough capabilities"
        ];

        return NextResponse.json({
            suggestions: fallback || defaultFallback
        });
    }
} 