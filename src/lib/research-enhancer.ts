// Enhanced research capabilities for academic papers and professional data

export interface ResearchPaper {
    title: string;
    authors: string[];
    abstract: string;
    methodology: string;
    keyFindings: string[];
    limitations: string[];
    innovations: string[];
    technicalSolutions: string[];
    citations: number;
    publishedDate: string;
    journal: string;
    doi?: string;
    problemStatement?: string;
    stateOfTheArt?: string;
    authorObservations?: string[];
    futureDirection?: string;
    githubLink?: string;
    relatedWork?: string;
    pdfLink?: string;
}

export interface ProfessionalProfile {
    name: string;
    title: string;
    company: string;
    email?: string;
    linkedin?: string;
    location?: string;
    experience: string[];
    skills: string[];
    education: string[];
}

export class ResearchEnhancer {

    /**
     * Analyzes academic paper content and extracts structured information
     */
    static analyzeResearchPaper(content: string): Partial<ResearchPaper> {
        const paper: Partial<ResearchPaper> = {};

        // Extract title (usually the first heading)
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (titleMatch) {
            paper.title = titleMatch[1].trim();
        }

        // Extract abstract
        const abstractMatch = content.match(/(?:abstract|summary)[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
        if (abstractMatch) {
            paper.abstract = abstractMatch[1].trim();
        }

        // Extract authors
        const authorsMatch = content.match(/(?:authors?|by)[:\s]*(.+?)(?:\n|$)/i);
        if (authorsMatch) {
            paper.authors = authorsMatch[1].split(/[,&]/).map(author => author.trim());
        }

        // Extract methodology
        const methodologyMatch = content.match(/(?:methodology|methods?|approach)[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
        if (methodologyMatch) {
            paper.methodology = methodologyMatch[1].trim();
        }

        // Extract Problem Statement
        const problemMatch = content.match(/(?:problem statement|problem we address)[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
        if (problemMatch) {
            paper.problemStatement = problemMatch[1].trim();
        }

        // Extract State of the Art / Related Work
        const relatedWorkMatch = content.match(/(?:state-of-the-art|related work|literature review)[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
        if (relatedWorkMatch) {
            paper.relatedWork = relatedWorkMatch[1].trim();
        }

        // Extract Author Observations
        paper.authorObservations = this.extractListItems(content, /(?:observations?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract Future Work/Direction
        const futureWorkMatch = content.match(/(?:future work|future direction|next steps)[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
        if (futureWorkMatch) {
            paper.futureDirection = futureWorkMatch[1].trim();
        }

        // Extract key findings
        paper.keyFindings = this.extractListItems(content, /(?:findings?|results?|conclusions?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract limitations
        paper.limitations = this.extractListItems(content, /(?:limitations?|weaknesses?|constraints?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract innovations
        paper.innovations = this.extractListItems(content, /(?:innovations?|novel|contributions?|advances?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract technical solutions
        paper.technicalSolutions = this.extractListItems(content, /(?:technical solutions?|implementations?|algorithms?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract citation count
        const citationMatch = content.match(/(?:cited|citations?)[:\s]*(\d+)/i);
        if (citationMatch) {
            paper.citations = parseInt(citationMatch[1]);
        }

        // Extract DOI
        const doiMatch = content.match(/doi[:\s]*(10\.\d+\/[^\s]+)/i);
        if (doiMatch) {
            paper.doi = doiMatch[1];
        }

        return paper;
    }

    /**
     * Extracts professional profile information from scraped content
     */
    static extractProfessionalProfile(content: string): Partial<ProfessionalProfile> {
        const profile: Partial<ProfessionalProfile> = {};

        // Extract name (usually in title or first heading)
        const nameMatch = content.match(/(?:^#\s+(.+)$|<title>(.+?)\s*[-|])/m);
        if (nameMatch) {
            profile.name = (nameMatch[1] || nameMatch[2]).trim();
        }

        // Extract title/position
        const titleMatch = content.match(/(?:title|position|role)[:\s]*(.+?)(?:\n|$)/i);
        if (titleMatch) {
            profile.title = titleMatch[1].trim();
        }

        // Extract company
        const companyMatch = content.match(/(?:company|organization|employer)[:\s]*(.+?)(?:\n|$)/i);
        if (companyMatch) {
            profile.company = companyMatch[1].trim();
        }

        // Extract email
        const emailMatch = content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
            profile.email = emailMatch[1];
        }

        // Extract LinkedIn
        const linkedinMatch = content.match(/(linkedin\.com\/in\/[a-zA-Z0-9-]+)/);
        if (linkedinMatch) {
            profile.linkedin = `https://${linkedinMatch[1]}`;
        }

        // Extract location
        const locationMatch = content.match(/(?:location|based in|lives in)[:\s]*(.+?)(?:\n|$)/i);
        if (locationMatch) {
            profile.location = locationMatch[1].trim();
        }

        // Extract experience
        profile.experience = this.extractListItems(content, /(?:experience|work history|employment)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract skills
        profile.skills = this.extractListItems(content, /(?:skills?|expertise|technologies)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        // Extract education
        profile.education = this.extractListItems(content, /(?:education|qualifications|degrees?)[:\s]*\n((?:[-*]\s.+\n?)+)/i);

        return profile;
    }

    /**
     * Formats research data into structured tables
     */
    static formatAsTable(data: Array<Record<string, any>>, title: string): string {
        if (!data.length) return '';

        const headers = Object.keys(data[0]);
        const headerRow = `| ${headers.join(' | ')} |`;
        const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
        const dataRows = data.map(row =>
            `| ${headers.map(header => row[header] || 'N/A').join(' | ')} |`
        );

        return `## ${title}\n\n${headerRow}\n${separatorRow}\n${dataRows.join('\n')}\n\n`;
    }

    /**
     * Creates comparison tables for multiple research papers
     */
    static compareResearchPapers(papers: Partial<ResearchPaper>[]): string {
        const comparisonData = papers.map(paper => ({
            'Title': paper.title?.substring(0, 50) + '...' || 'Unknown',
            'Authors': paper.authors?.slice(0, 2).join(', ') || 'Unknown',
            'Key Innovation': paper.innovations?.[0]?.substring(0, 60) + '...' || 'Not specified',
            'Main Limitation': paper.limitations?.[0]?.substring(0, 60) + '...' || 'Not specified',
            'Citations': paper.citations || 0,
            'Year': paper.publishedDate || 'Unknown'
        }));

        return this.formatAsTable(comparisonData, 'Research Papers Comparison');
    }

    /**
     * Creates professional profiles table
     */
    static formatProfessionalProfiles(profiles: Partial<ProfessionalProfile>[]): string {
        const profileData = profiles.map(profile => ({
            'Name': profile.name || 'Unknown',
            'Title': profile.title || 'Unknown',
            'Company': profile.company || 'Unknown',
            'Email': profile.email || 'Not found',
            'Location': profile.location || 'Unknown',
            'LinkedIn': profile.linkedin ? 'Available' : 'Not found'
        }));

        return this.formatAsTable(profileData, 'Professional Profiles');
    }

    /**
     * Extracts key insights and recommendations from research papers
     */
    static generateInsights(papers: Partial<ResearchPaper>[]): string {
        let insights = '## Research Insights & Recommendations\n\n';

        // Common limitations analysis
        const allLimitations = papers.flatMap(p => p.limitations || []);
        const limitationCounts = this.countOccurrences(allLimitations);

        if (limitationCounts.length > 0) {
            insights += '### Common Limitations Across Papers:\n';
            limitationCounts.slice(0, 5).forEach((item, index) => {
                insights += `${index + 1}. **${item.text}** (mentioned in ${item.count} papers)\n`;
            });
            insights += '\n';
        }

        // Innovation trends
        const allInnovations = papers.flatMap(p => p.innovations || []);
        const innovationCounts = this.countOccurrences(allInnovations);

        if (innovationCounts.length > 0) {
            insights += '### Key Innovation Trends:\n';
            innovationCounts.slice(0, 5).forEach((item, index) => {
                insights += `${index + 1}. **${item.text}** (${item.count} papers)\n`;
            });
            insights += '\n';
        }

        // Technical solutions summary
        const allSolutions = papers.flatMap(p => p.technicalSolutions || []);
        if (allSolutions.length > 0) {
            insights += '### Recommended Technical Approaches:\n';
            allSolutions.slice(0, 5).forEach((solution, index) => {
                insights += `${index + 1}. ${solution}\n`;
            });
            insights += '\n';
        }

        return insights;
    }

    /**
     * Helper method to extract list items from text
     */
    private static extractListItems(content: string, regex: RegExp): string[] {
        const match = content.match(regex);
        if (!match) return [];

        return match[1]
            .split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);
    }

    /**
     * Helper method to count occurrences of similar items
     */
    private static countOccurrences(items: string[]): Array<{ text: string, count: number }> {
        const counts = new Map<string, number>();

        items.forEach(item => {
            const normalized = item.toLowerCase().trim();
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });

        return Array.from(counts.entries())
            .map(([text, count]) => ({ text, count }))
            .sort((a, b) => b.count - a.count);
    }
} 