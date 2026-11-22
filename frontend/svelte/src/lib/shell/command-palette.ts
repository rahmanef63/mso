export type CommandItem = {
  id: string;
  label: string;
  category: string;
  keywords?: string[];
  shortcut?: string;
  run: () => void;
};

function scoreField(value: string, term: string, weights: readonly [number, number, number]): number {
  if (!value) return 0;
  if (value === term) return weights[0];
  if (value.startsWith(term)) return weights[1];
  if (value.includes(term)) return weights[2];
  return 0;
}

function scoreTerm(
  label: string,
  category: string,
  keywords: readonly string[],
  term: string,
): number {
  let best = scoreField(label, term, [120, 90, 65]);
  for (const kw of keywords) {
    const kwScore = scoreField(kw, term, [70, 55, 40]);
    if (kwScore > best) best = kwScore;
  }
  const catScore = scoreField(category, term, [45, 35, 25]);
  if (catScore > best) best = catScore;
  return best;
}

function scoreCommand(item: CommandItem, query: string, terms: readonly string[]): number {
  const label = item.label.trim().toLowerCase();
  const category = item.category.trim().toLowerCase();
  const keywords = (item.keywords ?? []).map((kw) => kw.trim().toLowerCase()).filter(Boolean);

  let total = 0;
  for (const term of terms) {
    const part = scoreTerm(label, category, keywords, term);
    if (part === 0) return 0;
    total += part;
  }

  // Reward full-phrase alignment on label when query has multiple terms or exact match.
  total += scoreField(label, query, [60, 35, 15]);
  return total;
}

export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...items];
  }
  const terms = normalized.split(/\s+/).filter(Boolean);
  const ranked: Array<{ item: CommandItem; score: number; index: number }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const score = scoreCommand(item, normalized, terms);
    if (score > 0) {
      ranked.push({ item, score, index });
    }
  }

  ranked.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return ranked.map((entry) => entry.item);
}
