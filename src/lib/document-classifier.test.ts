import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDocumentWithValidation } from './document-classifier.ts';

type Fixture = {
  name: string;
  input: {
    filename: string;
    description?: string;
    rawText?: string;
  };
  llm?: {
    document_type?: string;
    confidence?: number;
    rationale?: string;
    extracted_data?: Record<string, unknown>;
  };
  expected: {
    documentType: string;
    stage: 'clear' | 'ambiguous';
    askUserToConfirm: boolean;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'document-classifier');

test('document classifier fixtures', async () => {
  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 4, 'expected at least 4 classifier fixtures');

  for (const file of files) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf8');
    const fixture = JSON.parse(raw) as Fixture;

    const result = classifyDocumentWithValidation({
      ...fixture.input,
      llm: fixture.llm,
    });

    assert.equal(result.documentType, fixture.expected.documentType, `${fixture.name}: documentType`);
    assert.equal(result.stage, fixture.expected.stage, `${fixture.name}: stage`);
    assert.equal(result.askUserToConfirm, fixture.expected.askUserToConfirm, `${fixture.name}: askUserToConfirm`);
  }
});

test('fuel is never accepted from weak keyword alone', () => {
  const result = classifyDocumentWithValidation({
    filename: 'fuel-note.jpg',
    description: 'fuel',
    rawText: 'Receipt total 14.20 snack and coffee',
    llm: {
      document_type: 'fuel_receipt',
      confidence: 0.9,
      rationale: 'keyword match only',
      extracted_data: { amount_usd: 14.2 },
    },
  });

  assert.notEqual(result.documentType, 'fuel');
  assert.equal(result.stage, 'ambiguous');
});
