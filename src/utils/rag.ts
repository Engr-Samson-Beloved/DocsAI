export interface DocumentChunk {
  sourceName: string;
  text: string;
  tokenCountEstimate: number;
}

/**
 * Splits document content into overlapping chunks of ~150 words.
 * This ensures individual passages are sent rather than the whole document.
 */
export function chunkDocument(sourceName: string, text: string): DocumentChunk[] {
  if (!text) return [];
  // Basic cleaning of multiple spaces
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const words = cleanText.split(' ');
  const chunks: DocumentChunk[] = [];
  const chunkSize = 150;
  const overlap = 30;

  for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
    const chunkWords = words.slice(i, i + chunkSize);
    if (chunkWords.length < 10) continue; // Skip tiny trailing fragments
    
    const chunkText = chunkWords.join(' ');
    chunks.push({
      sourceName,
      text: chunkText,
      tokenCountEstimate: Math.ceil(chunkWords.length * 1.3)
    });

    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

/**
 * Basic term frequency matching helper for client-side search ranking (Local RAG).
 * Calculates term matching scores to find the most relevant chunks.
 */
export function retrieveRelevantChunks(
  query: string,
  allChunks: DocumentChunk[],
  topK: number = 3
): DocumentChunk[] {
  if (allChunks.length === 0) return [];
  if (!query) return allChunks.slice(0, topK);

  // Extract clean query terms (words with 3+ characters)
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (queryTerms.length === 0) {
    return allChunks.slice(0, topK);
  }

  // Score each chunk
  const scored = allChunks.map(chunk => {
    const chunkTextLower = chunk.text.toLowerCase();
    let score = 0;
    
    queryTerms.forEach(term => {
      if (chunkTextLower.includes(term)) {
        // Higher points for exact word boundary matches, lower points for substring matches
        const regex = new RegExp(`\\b${term}\\b`, 'g');
        const matches = chunkTextLower.match(regex);
        if (matches) {
          score += matches.length * 2.5; // Exact word match multiplier
        } else {
          score += 1.0; // Substring match
        }
      }
    });

    return { chunk, score };
  });

  // Sort and filter chunks that have some relevance
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.chunk)
    .slice(0, topK);
}
