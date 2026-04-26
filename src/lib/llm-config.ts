export type BuiltinProviderId = 'minimax' | 'claude' | 'zai' | 'openrouter-vision' | 'regex';
export type BuiltinModelId =
  | 'builtin:minimax-model'
  | 'builtin:claude-model'
  | 'builtin:zai-model'
  | 'builtin:openrouter-vision-model';

export type CustomProviderKind = 'openrouter' | 'openrouter-vision' | 'minimax' | 'zai';

export type OpenRouterModelOption = {
  value: string;
  label: string;
  provider: Extract<CustomProviderKind, 'openrouter' | 'openrouter-vision'>;
  description: string;
};

export type CustomLlmProvider = {
  id: string;
  name: string;
  provider: CustomProviderKind;
  model: string;
  api_key: string;
  enabled: boolean;
};

export const OPENROUTER_MODEL_OPTIONS: OpenRouterModelOption[] = [
  {
    value: 'qwen/qwen3-vl-235b-a22b-thinking',
    label: 'Qwen3 VL 235B A22B Thinking',
    provider: 'openrouter-vision',
    description: 'Primary multimodal reasoning model',
  },
  {
    value: 'qwen/qwen2.5-vl-72b-instruct',
    label: 'Qwen2.5 VL 72B Instruct',
    provider: 'openrouter-vision',
    description: 'High-capacity vision fallback',
  },
  {
    value: 'qwen/qwen3-vl-32b-instruct',
    label: 'Qwen3 VL 32B Instruct',
    provider: 'openrouter-vision',
    description: 'Smaller vision fallback',
  },
  {
    value: 'mistralai/ministral-14b-2512',
    label: 'Ministral 14B 2512',
    provider: 'openrouter',
    description: 'Mistral text model',
  },
  {
    value: 'mistralai/mistral-7b-instruct-v0.1',
    label: 'Mistral 7B Instruct v0.1',
    provider: 'openrouter',
    description: 'Small text fallback',
  },
];

export function getOpenRouterModelOption(model: string | null | undefined) {
  return OPENROUTER_MODEL_OPTIONS.find((entry) => entry.value === (model || '').trim()) || null;
}

export function isOpenRouterVisionModel(model: string | null | undefined) {
  return getOpenRouterModelOption(model)?.provider === 'openrouter-vision';
}

export const BUILTIN_PROVIDER_ORDER: BuiltinProviderId[] = [
  'minimax',
  'claude',
  'zai',
  'openrouter-vision',
  'regex',
];

export const BUILTIN_PROVIDER_DETAILS: Record<BuiltinProviderId, {
  label: string;
  description: string;
  modelId?: BuiltinModelId;
}> = {
  minimax: {
    label: 'Minimax M2.7',
    description: 'Primary model, independent app default',
    modelId: 'builtin:minimax-model',
  },
  claude: {
    label: 'Claude (Anthropic)',
    description: 'Best accuracy, vision support',
    modelId: 'builtin:claude-model',
  },
  zai: {
    label: 'Z.AI (GLM)',
    description: 'Alternative LLM',
    modelId: 'builtin:zai-model',
  },
  'openrouter-vision': {
    label: 'OpenRouter Vision',
    description: 'PDF/image extraction via vision model',
    modelId: 'builtin:openrouter-vision-model',
  },
  regex: {
    label: 'Regex Only',
    description: 'No AI, rule-based parsing only',
  },
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeCustomProviders(value: unknown): CustomLlmProvider[] {
  return parseJsonArray(value)
    .map((entry) => {
      const item = (entry || {}) as Record<string, unknown>;
      const provider = String(item.provider || '').trim() as CustomProviderKind;
      if (!['openrouter', 'openrouter-vision', 'minimax', 'zai'].includes(provider)) return null;
      const id = String(item.id || '').trim();
      if (!id) return null;
      return {
        id,
        name: String(item.name || '').trim() || `Custom ${provider}`,
        provider,
        model: String(item.model || '').trim(),
        api_key: String(item.api_key || ''),
        enabled: item.enabled === false ? false : true,
      } satisfies CustomLlmProvider;
    })
    .filter(Boolean) as CustomLlmProvider[];
}

export function serializeCustomProviders(value: CustomLlmProvider[]): string {
  return JSON.stringify(value);
}

function normalizeIdList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const allowedSet = new Set(allowed);
  return Array.from(new Set(
    parseJsonArray(value)
      .map((entry) => String(entry || '').trim())
      .filter((entry): entry is T => allowedSet.has(entry as T))
  ));
}

const BUILTIN_MODEL_IDS = Object.values(BUILTIN_PROVIDER_DETAILS)
  .map((entry) => entry.modelId)
  .filter(Boolean) as BuiltinModelId[];

export function normalizeDisabledProviderIds(value: unknown): BuiltinProviderId[] {
  return normalizeIdList(value, BUILTIN_PROVIDER_ORDER);
}

export function normalizeDisabledModelIds(value: unknown): BuiltinModelId[] {
  return normalizeIdList(value, BUILTIN_MODEL_IDS);
}

export function isBuiltinSelectionDisabled(
  providerId: BuiltinProviderId,
  disabledProviderIds: readonly BuiltinProviderId[],
  disabledModelIds: readonly BuiltinModelId[]
) {
  if (disabledProviderIds.includes(providerId)) return true;
  const modelId = BUILTIN_PROVIDER_DETAILS[providerId].modelId;
  return Boolean(modelId && disabledModelIds.includes(modelId));
}

export function getSelectableBuiltinProviders(
  disabledProviderIds: readonly BuiltinProviderId[],
  disabledModelIds: readonly BuiltinModelId[]
) {
  return BUILTIN_PROVIDER_ORDER.filter((providerId) => !isBuiltinSelectionDisabled(providerId, disabledProviderIds, disabledModelIds));
}

export function getEnabledCustomProviderKeys(customProviders: readonly CustomLlmProvider[]) {
  return customProviders.filter((entry) => entry.enabled).map((entry) => `custom:${entry.id}`);
}

export function getRuntimeMethodOrder(primary: string, customProviders: readonly CustomLlmProvider[]) {
  return [
    primary,
    ...BUILTIN_PROVIDER_ORDER,
    ...getEnabledCustomProviderKeys(customProviders),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

export function getSelectablePrimaryOptions(
  customProviders: readonly CustomLlmProvider[],
  disabledProviderIds: readonly BuiltinProviderId[],
  disabledModelIds: readonly BuiltinModelId[]
) {
  return [
    ...getSelectableBuiltinProviders(disabledProviderIds, disabledModelIds),
    ...getEnabledCustomProviderKeys(customProviders),
  ];
}

export function normalizeSelectablePrimary(
  primary: string,
  customProviders: readonly CustomLlmProvider[],
  disabledProviderIds: readonly BuiltinProviderId[],
  disabledModelIds: readonly BuiltinModelId[]
) {
  const selectable = getSelectablePrimaryOptions(customProviders, disabledProviderIds, disabledModelIds);
  return selectable.includes(primary) ? primary : (selectable[0] || primary || 'minimax');
}
