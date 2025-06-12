import Arxiv from 'arxiv-api';

interface Paper {
    title: string;
    authors: string[];
    summary: string;
    pdfLink: string;
}

export class ArxivClient {
    /**
     * Fetches a research paper from ArXiv and returns its key details.
     * @param url The ArXiv URL (e.g., https://arxiv.org/abs/1806.00183)
     * @returns A structured object with the paper's details or null if not found.
     */
    static async fetchPaper(url: string): Promise<Paper | null> {
        try {
            const arxivId = this.extractArxivId(url);
            if (!arxivId) {
                throw new Error('Could not extract ArXiv ID from the URL.');
            }

            const papers = await Arxiv.search({
                id_list: [arxivId],
                max_results: 1,
            });

            if (!papers || papers.length === 0) {
                return null;
            }

            const paper = papers[0];
            return {
                title: paper.title.trim(),
                authors: paper.authors || [],
                summary: paper.summary.trim(),
                pdfLink: paper.pdf,
            };
        } catch (error) {
            console.error('Failed to fetch paper from ArXiv:', error);
            return null;
        }
    }

    /**
     * Extracts the ArXiv ID from a URL.
     * @param url The ArXiv URL.
     * @returns The ArXiv ID or null if not found.
     */
    private static extractArxivId(url: string): string | null {
        const match = url.match(/(?:abs|pdf)\/(\d+\.\d+(v\d+)?)/);
        return match ? match[1] : null;
    }
} 