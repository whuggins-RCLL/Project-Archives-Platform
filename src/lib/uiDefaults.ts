import type { Settings } from './api';

export const COMMENT_REACTION_EMOJIS = ['👍', '🎉', '✅'] as const;

export const AI_PROVIDER_OPTIONS: Array<{ id: Settings['activeProvider']; name: string; desc: string }> = [
  { id: 'gemini', name: 'Google Gemini', desc: 'Google AI — model e.g. gemini-2.5-pro' },
  { id: 'openai', name: 'OpenAI', desc: 'Official OpenAI API (not Groq) — e.g. gpt-4o' },
  { id: 'anthropic', name: 'Anthropic Claude', desc: 'Anthropic Messages API — e.g. Claude 3.7' },
  { id: 'gemma', name: 'OpenAI-compatible (custom)', desc: 'GEMMA_API_KEY + GEMMA_BASE_URL for any chat-completions host' },
  { id: 'groq', name: 'Groq', desc: 'GroqCloud — GROQ_API_KEY; Llama, GPT-OSS, Qwen, …' },
  {
    id: 'groc',
    name: 'Second custom slot',
    desc: 'GROC_API_KEY + GROC_BASE_URL (OpenAI-shaped). Separate from Groq.',
  },
];

export const PDF_LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 50,
  topY: 770,
  lineHeight: 20,
  fontSize: 10,
};
