import type { Settings } from './api';

export const COMMENT_REACTION_EMOJIS = ['👍', '🎉', '✅'] as const;

export const AI_PROVIDER_OPTIONS: Array<{ id: Settings['activeProvider']; name: string; desc: string }> = [
  { id: 'gemini', name: 'Google Gemini', desc: 'gemini-2.5-pro' },
  { id: 'openai', name: 'OpenAI', desc: 'gpt-4o' },
  { id: 'anthropic', name: 'Anthropic Claude', desc: 'claude-3-7-sonnet' },
  { id: 'gemma', name: 'Gemma (compat)', desc: 'Any OpenAI-compatible base URL' },
  { id: 'groq', name: 'Groq', desc: 'GroqCloud chat (Llama, GPT-OSS, Qwen, …)' },
  { id: 'groc', name: 'Groc', desc: 'OpenAI-compatible endpoint' },
];

export const PDF_LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 50,
  topY: 770,
  lineHeight: 20,
  fontSize: 10,
};
