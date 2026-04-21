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
    description: 'OpenAI-compatible endpoint (e.g. self-hosted or third-party).',
    provider: 'gemma',
  },
  {
    id: 'groc-2-latest',
    label: 'Groc 2 Latest',
    description: 'Groc model via OpenAI-compatible endpoint.',
    provider: 'groc',
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile',
    description: 'Groq production — strong general reasoning (Groq docs).',
    provider: 'groq',
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant',
    description: 'Groq production — fast and inexpensive for lighter tasks.',
    provider: 'groq',
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT OSS 120B',
    description: 'Groq production — open-weight flagship on GroqCloud.',
    provider: 'groq',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT OSS 20B',
    description: 'Groq production — smaller open-weight model, very high throughput.',
    provider: 'groq',
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B 16E',
    description: 'Groq preview — MoE; check Groq deprecations before production use.',
    provider: 'groq',
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen3 32B',
    description: 'Groq preview — broad capability; verify availability in your Groq project.',
    provider: 'groq',
  },
];
