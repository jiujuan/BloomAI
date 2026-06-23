export const PERSONA_COLORS: Record<string, string> = {
  developer: '#534AB7',
  writer: '#0F6E56',
  analyst: '#BA7517',
  translator: '#185FA5',
  coach: '#993C1D',
}

export const MODEL_LABELS: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'claude-3.5-sonnet',
  'claude-3-opus-20240229': 'claude-3-opus',
  'claude-3-haiku-20240307': 'claude-3-haiku',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
}

export const AVAILABLE_MODELS = [
  { id: 'claude-3-5-sonnet-20241022', label: 'claude-3.5-sonnet', provider: 'Anthropic', badge: 'Recommended' },
  { id: 'claude-3-opus-20240229', label: 'claude-3-opus', provider: 'Anthropic', badge: 'Powerful' },
  { id: 'claude-3-haiku-20240307', label: 'claude-3-haiku', provider: 'Anthropic', badge: 'Fast' },
  { id: 'gpt-4o', label: 'gpt-4o', provider: 'OpenAI', badge: '' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', provider: 'OpenAI', badge: 'Cheap' },
]
