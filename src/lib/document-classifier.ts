export type DocumentDraftType = 'itinerary' | 'fuel' | 'toll' | 'reimbursement' | 'other' | 'receipt' | 'unknown';

export type SmartIntakeLlmResult = {
  document_type?: string | null;
  confidence?: number | null;
  rationale?: string | null;
  extracted_data?: Record<string, unknown> | null;
};

export type ClassificationStage = 'clear' | 'ambiguous';

export type ClassificationOutcome = {
  documentType: DocumentDraftType;
  confidence: number;
  rationale: string;
  stage: ClassificationStage;
  askUserToConfirm: boolean;
  llmType: DocumentDraftType;
  llmConfidence: number | null;
  inferredType: DocumentDraftType;
};

const ITINERARY_EVENT_PATTERN = /\b(?:pickup|deliver|drop|hook|acquire|release|border crossing)\b/gi;
const ITINERARY_CONTEXT_PATTERN = /\b(?:trip|itinerary|dispatch|driver|load|consignee|shipper|trailer|tractor|bol|pickup #|delivery #)\b/gi;
const FUEL_SIGNAL_PATTERN = /\b(fuel|diesel|def|pump|gallons?|gal\b|liters?|litres?|odometer|price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|ppu)\b/gi;
const FUEL_STRONG_SIGNAL_PATTERN = /\b(diesel|def|diesel\s*#?\s*1|diesel\s*#?\s*2|unleaded|pump\s*#?\s*\d+|odometer|\d+(?:\.\d+)?\s*(?:gal|gallons?|liters?|litres?)|\$\s*\d+(?:\.\d{2,3})?\s*\/(?:gal|gallon|l|liter|litre)|price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|ppu)\b/gi;
const NON_FUEL_RECEIPT_PATTERN = /\b(toll|ez\s*pass|ezpass|bridge|parking|plate\s*pass|turnpike|highway|reimb(?:ursement)?|expense|hotel|meal|food|repair|maintenance|wash|scale|weigh|lumper)\b/gi;
const TOLL_SIGNAL_PATTERN = /\b(toll|ez\s*pass|ezpass|plate\s*pass|bridge|turnpike|highway\s*toll|407)\b/i;
const REIMBURSEMENT_SIGNAL_PATTERN = /\b(reimb(?:ursement)?|expense\s*report|out\s*of\s*pocket|per\s*diem|hotel|meal|taxi|uber|lyft|parking)\b/i;

export const AMBIGUITY_CONFIDENCE_THRESHOLD = 0.72;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeConfidence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1 && numeric <= 100) return clamp(numeric / 100);
  return clamp(numeric);
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return !['null', 'undefined', 'n/a', 'na', 'none'].includes(normalized);
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function hasFuelFieldHints(data?: Record<string, unknown> | null) {
  if (!data) return false;
  return Boolean(
    isMeaningfulValue(data.gallons) ||
    isMeaningfulValue(data.liters) ||
    isMeaningfulValue(data.price_per_unit) ||
    isMeaningfulValue(data.odometer) ||
    isMeaningfulValue(data.def_gallons) ||
    isMeaningfulValue(data.def_liters) ||
    isMeaningfulValue(data.def_price_per_unit)
  );
}

export function normalizeDocumentType(type: DocumentDraftType | string | null | undefined): DocumentDraftType {
  if (type === 'dispatch_itinerary' || type === 'itinerary') return 'itinerary';
  if (type === 'fuel_receipt') return 'fuel';
  if (type === 'toll_receipt') return 'toll';
  if (type === 'receipt') return 'other';
  if (type === 'fuel' || type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'unknown') return type;
  return 'unknown';
}

function hasItineraryStructure(haystack: string) {
  if (/trip itinerary|driver trip itinerary|dispatch itinerary/.test(haystack)) return true;

  const eventCount = haystack.match(ITINERARY_EVENT_PATTERN)?.length || 0;
  const hasTripNumber = /\bt\d{4,}\b/.test(haystack);
  const hasItineraryContext = (haystack.match(ITINERARY_CONTEXT_PATTERN)?.length || 0) >= 1;

  if (hasTripNumber && eventCount >= 1) return true;
  if (eventCount >= 2 && hasItineraryContext) return true;

  return false;
}

function fuelSignalScore(haystack: string) {
  return haystack.match(FUEL_SIGNAL_PATTERN)?.length || 0;
}

function fuelStrongSignalScore(haystack: string) {
  return haystack.match(FUEL_STRONG_SIGNAL_PATTERN)?.length || 0;
}

function nonFuelSignalScore(haystack: string) {
  return haystack.match(NON_FUEL_RECEIPT_PATTERN)?.length || 0;
}

function createHaystack(filename: string, description?: string | null, rawText?: string | null) {
  return `${filename} ${description || ''} ${rawText || ''}`.toLowerCase();
}

export function inferDocumentType(filename: string, description?: string | null, rawText?: string | null): DocumentDraftType {
  const haystack = createHaystack(filename, description, rawText);
  const strongFuel = fuelStrongSignalScore(haystack);

  if (hasItineraryStructure(haystack)) return 'itinerary';
  if (TOLL_SIGNAL_PATTERN.test(haystack) && strongFuel === 0) return 'toll';
  if (REIMBURSEMENT_SIGNAL_PATTERN.test(haystack) && strongFuel === 0) return 'reimbursement';
  if (strongFuel >= 1 && nonFuelSignalScore(haystack) === 0) return 'fuel';
  if (TOLL_SIGNAL_PATTERN.test(haystack)) return 'toll';
  if (REIMBURSEMENT_SIGNAL_PATTERN.test(haystack)) return 'reimbursement';
  if (/receipt|parking|scale|lumper|repair|wash/.test(haystack)) return 'other';
  return 'unknown';
}

function confidenceFromSignals(type: DocumentDraftType, haystack: string) {
  const strongFuel = fuelStrongSignalScore(haystack);
  const weakFuel = fuelSignalScore(haystack);
  const nonFuel = nonFuelSignalScore(haystack);

  if (type === 'itinerary') return hasItineraryStructure(haystack) ? 0.95 : 0.75;
  if (type === 'fuel') {
    if (strongFuel >= 2 && nonFuel === 0) return 0.9;
    if (strongFuel >= 1 && nonFuel <= 1) return 0.8;
    if (weakFuel >= 2) return 0.62;
    return 0.5;
  }
  if (type === 'toll') return TOLL_SIGNAL_PATTERN.test(haystack) ? 0.88 : 0.63;
  if (type === 'reimbursement') return REIMBURSEMENT_SIGNAL_PATTERN.test(haystack) ? 0.85 : 0.63;
  if (type === 'other') return /receipt|invoice|expense/.test(haystack) ? 0.72 : 0.58;
  return 0.45;
}

export function classifyDocumentWithValidation(params: {
  filename: string;
  description?: string | null;
  rawText?: string | null;
  llm?: SmartIntakeLlmResult | null;
  ambiguityThreshold?: number;
}): ClassificationOutcome {
  const haystack = createHaystack(params.filename, params.description, params.rawText);
  const inferredType = inferDocumentType(params.filename, params.description, params.rawText);
  const llmType = normalizeDocumentType(params.llm?.document_type);
  const llmConfidence = normalizeConfidence(params.llm?.confidence);
  const strongFuel = fuelStrongSignalScore(haystack);
  const weakFuel = fuelSignalScore(haystack);
  const nonFuel = nonFuelSignalScore(haystack);
  const hasToll = TOLL_SIGNAL_PATTERN.test(haystack);
  const hasReimbursement = REIMBURSEMENT_SIGNAL_PATTERN.test(haystack);
  const fuelHints = hasFuelFieldHints(params.llm?.extracted_data || null);

  let documentType = llmType !== 'unknown' ? llmType : inferredType;
  let confidence = llmConfidence ?? confidenceFromSignals(documentType, haystack);
  const rationaleBits: string[] = [];

  if (params.llm?.rationale) rationaleBits.push(String(params.llm.rationale));
  if (llmType !== 'unknown') rationaleBits.push(`LLM proposed ${llmType}`);
  rationaleBits.push(`rules inferred ${inferredType}`);

  if (documentType === 'fuel' && strongFuel === 0 && !fuelHints) {
    documentType = inferredType === 'fuel' ? 'other' : inferredType;
    confidence = Math.min(confidence, 0.56);
    rationaleBits.push('downgraded fuel, no strong fuel signals or extracted fuel fields');
  }

  if (documentType === 'fuel' && strongFuel === 0 && weakFuel > 0) {
    confidence = Math.min(confidence, 0.62);
    rationaleBits.push('fuel keywords were weak only');
  }

  if (documentType === 'fuel' && (hasToll || hasReimbursement || nonFuel >= 2) && strongFuel === 0) {
    if (hasToll) documentType = 'toll';
    else if (hasReimbursement) documentType = 'reimbursement';
    else documentType = inferredType === 'unknown' ? 'other' : inferredType;
    confidence = Math.min(confidence, 0.6);
    rationaleBits.push('fuel proposal conflicted with stronger non-fuel signals');
  }

  if ((llmType === 'toll' || llmType === 'reimbursement' || llmType === 'other') && strongFuel >= 2 && nonFuel === 0) {
    documentType = 'fuel';
    confidence = Math.max(confidence, 0.82);
    rationaleBits.push('upgraded to fuel due to multiple strong fuel signals');
  }

  if (llmType !== 'unknown' && inferredType !== 'unknown' && llmType !== inferredType) {
    confidence = Math.min(confidence, 0.68);
    rationaleBits.push(`LLM/rules conflict (${llmType} vs ${inferredType})`);
  }

  if (documentType === 'toll' && hasToll && strongFuel === 0) {
    confidence = Math.max(confidence, 0.8);
  }

  if (documentType === 'reimbursement' && hasReimbursement && strongFuel === 0) {
    confidence = Math.max(confidence, 0.8);
  }

  if (documentType === 'unknown') {
    confidence = Math.min(confidence, 0.45);
    rationaleBits.push('document type could not be determined confidently');
  }

  confidence = clamp(confidence);
  const threshold = params.ambiguityThreshold ?? AMBIGUITY_CONFIDENCE_THRESHOLD;
  const askUserToConfirm = confidence < threshold;
  const stage: ClassificationStage = askUserToConfirm ? 'ambiguous' : 'clear';

  return {
    documentType,
    confidence,
    rationale: rationaleBits.filter(Boolean).join(' | '),
    stage,
    askUserToConfirm,
    llmType,
    llmConfidence,
    inferredType,
  };
}

export const CLASSIFIER_TEST_HELPERS = {
  inferDocumentType,
  classifyDocumentWithValidation,
  normalizeDocumentType,
};
