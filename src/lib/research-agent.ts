import { FirecrawlClient } from './firecrawl';
import { ResearchEnhancer, ResearchPaper, ProfessionalProfile } from './research-enhancer';
import { ArxivClient } from './arxiv';

export interface ResearchRequest {
    url: string;
    type: 'academic' | 'professional' | 'general' | 'arxiv';
    analysisDepth: 'basic' | 'detailed' | 'comprehensive';
}

export interface ResearchResult {
    content: string;
    structuredData?: Partial<ResearchPaper> | Partial<ProfessionalProfile>;
    insights?: string;
    tables?: string;
    recommendations?: string[];
}

export class ResearchAgent {

    private static firecrawlClient = new FirecrawlClient();

    /**
     * Main research method that handles different types of URLs and analysis
     */
    static async conductResearch(request: ResearchRequest): Promise<ResearchResult> {
        try {
            // Determine research type if not specified early for special handling
            const researchType = request.type || this.detectResearchType(request.url, '');

            // Handle ArXiv URLs separately
            if (researchType === 'arxiv') {
                const paper = await ArxivClient.fetchPaper(request.url);
                if (!paper) {
                    throw new Error('Failed to fetch paper from ArXiv.');
                }
                // Use the abstract as the main content for analysis
                return this.processAcademicContent(paper.summary, 'comprehensive', {
                    title: paper.title,
                    authors: paper.authors,
                    pdfLink: paper.pdfLink,
                });
            }

            // Scrape the URL content for other types
            const scrapeResult = await this.firecrawlClient.scrapeUrl(request.url);

            if (!scrapeResult.success || !scrapeResult.markdown) {
                throw new Error('Failed to scrape content from the provided URL');
            }
            const scrapedContent = scrapeResult.markdown;

            // Process based on research type
            switch (researchType) {
                case 'academic':
                    return this.processAcademicContent(scrapedContent, request.analysisDepth);

                case 'professional':
                    return this.processProfessionalContent(scrapedContent, request.analysisDepth);

                default:
                    return this.processGeneralContent(scrapedContent, request.analysisDepth);
            }

        } catch (error) {
            console.error('Research error:', error);
            throw new Error(`Research failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Processes multiple URLs for comparative analysis
     */
    static async conductComparativeResearch(urls: string[], type: 'academic' | 'professional' = 'academic'): Promise<ResearchResult> {
        const results: ResearchResult[] = [];

        for (const url of urls) {
            try {
                const result = await this.conductResearch({
                    url,
                    type,
                    analysisDepth: 'detailed'
                });
                results.push(result);
            } catch (error) {
                console.error(`Failed to process ${url}:`, error);
                // Continue with other URLs
            }
        }

        return this.aggregateResults(results, type);
    }

    /**
     * Specialized Google Scholar paper analysis
     */
    static async analyzeGoogleScholarPaper(url: string): Promise<ResearchResult> {
        // Extract paper details from Google Scholar URL
        const paperInfo = this.extractScholarInfo(url);

        // Scrape the actual paper if available
        let content = '';
        let paperUrl = url;

        // Try to find direct paper link from Scholar page
        if (url.includes('scholar.google.com')) {
            const scholarPageResult = await this.firecrawlClient.scrapeUrl(url);
            if (scholarPageResult.success && scholarPageResult.markdown) {
                const scholarPage = scholarPageResult.markdown;
                const directLink = this.extractDirectPaperLink(scholarPage);
                if (directLink) {
                    paperUrl = directLink;
                    const paperContentResult = await this.firecrawlClient.scrapeUrl(directLink);
                    if (paperContentResult.success && paperContentResult.markdown) {
                        content = paperContentResult.markdown;
                    }
                } else {
                    content = scholarPage;
                }
            }
        } else {
            const paperContentResult = await this.firecrawlClient.scrapeUrl(url);
            if (paperContentResult.success && paperContentResult.markdown) {
                content = paperContentResult.markdown;
            }
        }

        return this.processAcademicContent(content, 'comprehensive', paperInfo);
    }

    /**
     * Enhanced LinkedIn profile extraction
     */
    static async extractLinkedInProfiles(urls: string[]): Promise<ResearchResult> {
        const profiles: Partial<ProfessionalProfile>[] = [];
        let combinedContent = '';

        for (const url of urls) {
            try {
                // LinkedIn scraping requires special handling due to anti-bot measures
                const content = await this.scrapeLinkedInSafely(url);
                if (content) {
                    combinedContent += content + '\n\n---\n\n';
                    const profile = ResearchEnhancer.extractProfessionalProfile(content);
                    profiles.push(profile);
                }
            } catch (error) {
                console.error(`Failed to scrape LinkedIn profile ${url}:`, error);
            }
        }

        const tables = ResearchEnhancer.formatProfessionalProfiles(profiles);
        const insights = this.generateProfessionalInsights(profiles);

        return {
            content: combinedContent,
            structuredData: profiles.length === 1 ? profiles[0] : undefined,
            tables,
            insights,
            recommendations: this.generateProfessionalRecommendations(profiles)
        };
    }

    /**
     * Process academic content with enhanced analysis
     */
    private static async processAcademicContent(
        content: string,
        depth: string,
        priorInfo?: Partial<ResearchPaper>
    ): Promise<ResearchResult> {
        const paper = ResearchEnhancer.analyzeResearchPaper(content);

        // Merge with prior information if available
        const enrichedPaper = priorInfo ? { ...paper, ...priorInfo } : paper;

        // Search for related code
        if (enrichedPaper.title) {
            const codeSearchResults = await this.searchForCode(enrichedPaper.title);
            if (codeSearchResults && codeSearchResults.length > 0) {
                enrichedPaper.githubLink = codeSearchResults[0].url;
            }
        }

        let insights = '';
        let recommendations: string[] = [];

        if (depth === 'detailed' || depth === 'comprehensive') {
            insights = this.generateAcademicInsights(enrichedPaper);
            recommendations = this.generateAcademicRecommendations(enrichedPaper);
        }

        return {
            content: await this.enhanceAcademicContent(content, enrichedPaper),
            structuredData: enrichedPaper,
            insights,
            recommendations
        };
    }

    /**
     * Process professional content
     */
    private static processProfessionalContent(content: string, depth: string): ResearchResult {
        const profile = ResearchEnhancer.extractProfessionalProfile(content);

        let insights = '';
        let recommendations: string[] = [];

        if (depth === 'detailed' || depth === 'comprehensive') {
            insights = this.generateProfessionalInsights([profile]);
            recommendations = this.generateProfessionalRecommendations([profile]);
        }

        return {
            content: this.enhanceProfessionalContent(content, profile),
            structuredData: profile,
            insights,
            recommendations
        };
    }

    /**
     * Process general content
     */
    private static processGeneralContent(content: string, depth: string): ResearchResult {
        return {
            content: this.enhanceGeneralContent(content),
            recommendations: depth !== 'basic' ? this.generateGeneralRecommendations(content) : undefined
        };
    }

    /**
     * Detect research type from URL and content
     */
    private static detectResearchType(url: string, content: string): 'academic' | 'professional' | 'general' | 'arxiv' {
        // ArXiv papers are a special case of academic papers
        if (url.includes('arxiv.org')) {
            return 'arxiv';
        }

        // Academic indicators
        if (url.includes('scholar.google.com') ||
            url.includes('researchgate.net') ||
            url.includes('ieee.org') ||
            url.includes('acm.org') ||
            /\.(edu|ac\.)/i.test(url) ||
            /(?:abstract|methodology|citations?|doi)/i.test(content)) {
            return 'academic';
        }

        // Professional indicators
        if (url.includes('linkedin.com') ||
            /(?:profile|experience|skills|employment|cv|resume)/i.test(content)) {
            return 'professional';
        }

        return 'general';
    }

    /**
     * Enhanced content formatting for academic papers
     */
    private static async enhanceAcademicContent(content: string, paper: Partial<ResearchPaper>): Promise<string> {
        let enhanced = ``;

        // Add structured sections based on user questions
        if (paper.title) {
            enhanced += `# ${paper.title}\n\n`;
        }
        if (paper.authors && paper.authors.length > 0) {
            enhanced += `**Authors:** ${paper.authors.join(', ')}\n\n`;
        }
        if (paper.pdfLink) {
            enhanced += `**[View PDF](${paper.pdfLink})**\n\n`;
        }

        if (paper.problemStatement) {
            enhanced += `## What is the problem that author address in this paper?\n${paper.problemStatement}\n\n`;
        }

        if (paper.relatedWork) {
            enhanced += `## What is the state-of-the-art of the paper and their limitations?\n${paper.relatedWork}\n\n`;
        }

        if (paper.authorObservations && paper.authorObservations.length > 0) {
            enhanced += `## What is the author observation?\n${paper.authorObservations.map(o => `- ${o}`).join('\n')}\n\n`;
        }

        if (paper.innovations && paper.innovations.length > 0) {
            enhanced += `## What is the author key innovation?\n${paper.innovations.map(i => `- ${i}`).join('\n')}\n\n`;
        }

        if (paper.keyFindings && paper.keyFindings.length > 0) {
            enhanced += `## What is the key findings, and how author solve it?\n${paper.keyFindings.map(f => `- ${f}`).join('\n')}\n\n`;
        }

        if (paper.futureDirection) {
            enhanced += `## What is the future direction?\n${paper.futureDirection}\n\n`;
        }

        if (paper.githubLink) {
            enhanced += `## Open source code of this project or something similar\nWe found a potentially relevant GitHub repository:\n- [${paper.githubLink}](${paper.githubLink})\n\n`;
        } else {
            enhanced += `## Open source code of this project or something similar\nNo direct open source code link was found for this paper. You can try searching on GitHub for implementations.\n\n`;
        }

        // Add original content for reference
        enhanced += `\n\n---\n\n## Original Abstract\n${paper.abstract || 'Not found.'}`;

        return enhanced;
    }

    /**
     * Enhanced content formatting for professional profiles
     */
    private static enhanceProfessionalContent(content: string, profile: Partial<ProfessionalProfile>): string {
        let enhanced = content;

        if (profile.name && !content.includes(profile.name)) {
            enhanced = `# ${profile.name}\n\n${enhanced}`;
        }

        if (profile.title && profile.company) {
            enhanced += `\n\n**Current Position:** ${profile.title} at ${profile.company}`;
        }

        if (profile.email) {
            enhanced += `\n**Contact:** ${profile.email}`;
        }

        if (profile.experience && profile.experience.length > 0) {
            enhanced += `\n\n## Experience\n${profile.experience.map(e => `- ${e}`).join('\n')}`;
        }

        if (profile.skills && profile.skills.length > 0) {
            enhanced += `\n\n## Skills\n${profile.skills.map(s => `- ${s}`).join('\n')}`;
        }

        return enhanced;
    }

    /**
     * Enhanced content formatting for general content
     */
    private static enhanceGeneralContent(content: string): string {
        // Add structure to unstructured content
        return content.replace(/^([A-Z][^.!?]*[.!?])\s*$/gm, '## $1\n');
    }

    /**
     * Generate academic insights
     */
    private static generateAcademicInsights(paper: Partial<ResearchPaper>): string {
        let insights = '## Research Analysis\n\n';

        if (paper.innovations && paper.innovations.length > 0) {
            insights += '### Novel Contributions:\n';
            paper.innovations.forEach((innovation, index) => {
                insights += `${index + 1}. ${innovation}\n`;
            });
            insights += '\n';
        }

        if (paper.limitations && paper.limitations.length > 0) {
            insights += '### Research Limitations:\n';
            paper.limitations.forEach((limitation, index) => {
                insights += `${index + 1}. ${limitation}\n`;
            });
            insights += '\n';
        }

        if (paper.technicalSolutions && paper.technicalSolutions.length > 0) {
            insights += '### Technical Approaches:\n';
            paper.technicalSolutions.forEach((solution, index) => {
                insights += `${index + 1}. ${solution}\n`;
            });
        }

        return insights;
    }

    /**
     * Generate professional insights
     */
    private static generateProfessionalInsights(profiles: Partial<ProfessionalProfile>[]): string {
        let insights = '## Professional Analysis\n\n';

        // Skill analysis
        const allSkills = profiles.flatMap(p => p.skills || []);
        const skillCounts = this.countItems(allSkills);

        if (skillCounts.length > 0) {
            insights += '### Top Skills:\n';
            skillCounts.slice(0, 10).forEach((skill, index) => {
                insights += `${index + 1}. **${skill.item}** (${skill.count} professionals)\n`;
            });
            insights += '\n';
        }

        // Company analysis
        const companies = profiles.map(p => p.company).filter(Boolean);
        const uniqueCompanies = [...new Set(companies)];

        if (uniqueCompanies.length > 0) {
            insights += '### Companies Represented:\n';
            uniqueCompanies.forEach((company, index) => {
                insights += `${index + 1}. ${company}\n`;
            });
        }

        return insights;
    }

    /**
     * Helper methods
     */
    private static extractScholarInfo(url: string): Partial<ResearchPaper> {
        // Extract information from Google Scholar URL parameters
        const urlParams = new URLSearchParams(url.split('?')[1]);
        return {
            // Add any extractable information from Scholar URL
        };
    }

    private static extractDirectPaperLink(scholarPage: string): string | null {
        // Extract direct PDF or paper link from Scholar page
        const linkMatch = scholarPage.match(/href="([^"]*\.pdf[^"]*)"/i);
        return linkMatch ? linkMatch[1] : null;
    }

    private static async scrapeLinkedInSafely(url: string): Promise<string | null> {
        try {
            // Use delays and user-agent rotation for LinkedIn
            await new Promise(resolve => setTimeout(resolve, 2000));
            const result = await this.firecrawlClient.scrapeUrl(url);
            return result.success ? result.markdown : null;
        } catch (error) {
            console.warn('LinkedIn scraping blocked, trying alternative approach');
            return null;
        }
    }

    private static async searchForCode(paperTitle: string): Promise<any[]> {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            console.warn('Tavily API key not found, skipping code search.');
            return [];
        }

        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    query: `"${paperTitle}"`,
                    search_depth: 'advanced',
                    include_domains: ['github.com'],
                    max_results: 3,
                }),
            });

            if (!response.ok) {
                throw new Error(`Tavily API error: ${response.status}`);
            }

            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('Failed to search for code:', error);
            return [];
        }
    }

    private static generateAcademicRecommendations(paper: Partial<ResearchPaper>): string[] {
        const recommendations: string[] = [];

        if (paper.limitations && paper.limitations.length > 0) {
            recommendations.push('Address identified limitations in future research');
            recommendations.push('Consider alternative methodological approaches');
        }

        if (paper.innovations && paper.innovations.length > 0) {
            recommendations.push('Build upon the novel contributions presented');
            recommendations.push('Explore practical applications of the innovations');
        }

        return recommendations;
    }

    private static generateProfessionalRecommendations(profiles: Partial<ProfessionalProfile>[]): string[] {
        const recommendations: string[] = [];

        recommendations.push('Verify contact information before outreach');
        recommendations.push('Personalize messages based on professional background');
        recommendations.push('Consider mutual connections for warm introductions');

        return recommendations;
    }

    private static generateGeneralRecommendations(content: string): string[] {
        return [
            'Verify information from multiple sources',
            'Check publication date for currency',
            'Look for author credentials and bias'
        ];
    }

    private static aggregateResults(results: ResearchResult[], type: string): ResearchResult {
        const combinedContent = results.map(r => r.content).join('\n\n---\n\n');

        if (type === 'academic') {
            const papers = results.map(r => r.structuredData as Partial<ResearchPaper>).filter(Boolean);
            return {
                content: combinedContent,
                tables: ResearchEnhancer.compareResearchPapers(papers),
                insights: ResearchEnhancer.generateInsights(papers)
            };
        }

        return { content: combinedContent };
    }

    private static countItems(items: string[]): Array<{ item: string, count: number }> {
        const counts = new Map<string, number>();

        items.forEach(item => {
            const normalized = item.toLowerCase().trim();
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });

        return Array.from(counts.entries())
            .map(([item, count]) => ({ item, count }))
            .sort((a, b) => b.count - a.count);
    }
} 