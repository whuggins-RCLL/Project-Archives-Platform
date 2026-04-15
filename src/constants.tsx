import { AIModelOption } from './types';

export const AI_MODEL_OPTIONS: AIModelOption[] = [
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Google flagship reasoning and long-context model.',
    provider: 'gemini',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Balanced multimodal OpenAI model for fast, high-quality output.',
    provider: 'openai',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    label: 'Claude 3.7 Sonnet',
    description: 'Anthropic model tuned for analysis, writing, and tool workflows.',
    provider: 'anthropic',
  },
  {
    id: 'gemma-7b-it',
    label: 'Gemma 7B Instruct',
    description: 'Default Gemma instruct model served via OpenAI-compatible API.',
    provider: 'gemma',
  },
  {
    id: 'groc-2-latest',
    label: 'Groc 2 Latest',
    description: 'Groc model via OpenAI-compatible endpoint.',
    provider: 'groc',
  },
];
