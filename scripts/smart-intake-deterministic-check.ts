import { readFileSync } from 'fs';
import { join } from 'path';
import { SMART_INTAKE_TEST_HELPERS as h } from '../src/lib/document-processing';

type Case = {
  name: string;
  filename: string;
  text: string;
  expectedType: 'fuel' | 'toll' | 'reimbursement' | 'other' | 'itinerary' | 'unknown';
  expectedAmount?: number;
};

const cases: Case[] = [
  {
    name: 'fuel receipt',
    filename: 'love-fuel-receipt.jpg',
    text: 'LOVE\nDiesel #2\n55.31 GAL\nPrice/gal $3.799\nOdometer 789456\nTOTAL $210.22',
    expectedType: 'fuel',
    expectedAmount: 210.22,
  },
  {
    name: 'toll receipt',
    filename: '407-toll.pdf',
    text: 'Ontario 407 ETR\nPlate Pass Toll Charge\nTrip Date 04/10/2026\nAmount Due CAD 18.75',
    expectedType: 'toll',
    expectedAmount: 18.75,
  },
  {
    name: 'generic reimbursement receipt',
    filename: 'hotel-reimbursement.pdf',
    text: 'Travel Expense Receipt\nHotel stay reimbursement\nDate 04/11/2026\nGrand Total USD 139.90',
    expectedType: 'reimbursement',
    expectedAmount: 139.9,
  },
  {
    name: 'ocr spaced currency total',
    filename: 'fuel-scan-ocr.jpg',
    text: 'Diesel Fuel\nAmount Due CAD 1 208 . 12\nOdometer 812233',
    expectedType: 'fuel',
    expectedAmount: 1208.12,
  },
  {
    name: 'ocr punctuation artifact total',
    filename: 'receipt-ocr.png',
    text: 'Store Receipt\nTOTAL : $ 008 : 12\nThank You',
    expectedType: 'other',
    expectedAmount: 8.12,
  },
  {
    name: 'actual fuel ocr total should prefer charged amount',
    filename: '2026-04-14-love-475-sweetwater-tx.jpg',
    text: 'STORE 475\n9418 North Interstate 20\nSweetwater, TX 79556\n04/14/2026 Tkt #99242754\nPump: 2\nGallons: 183.682\nPrice / Gal 5.649\nsubtotal 1037.62\nsales Tax 0.00\nTotal 1637.62\nReceived TCHEK 1037.62\nINVOICE# 08887\nDate: 04/14/2026\n$1037.62\nTotal Sale:',
    expectedType: 'fuel',
    expectedAmount: 1037.62,
  },
];

let failed = 0;
for (const testCase of cases) {
  const actualType = h.inferDocumentType(testCase.filename, null, testCase.text);
  const amount = h.pickAmount(testCase.text);

  const typeOk = actualType === testCase.expectedType;
  const amountOk = testCase.expectedAmount === undefined
    ? true
    : amount !== null && Math.abs(amount - testCase.expectedAmount) < 0.001;

  if (!typeOk || !amountOk) {
    failed += 1;
    console.error(`✗ ${testCase.name}`);
    console.error(`  type expected=${testCase.expectedType} actual=${actualType}`);
    console.error(`  amount expected=${testCase.expectedAmount ?? 'n/a'} actual=${amount ?? 'null'}`);
  } else {
    console.log(`✓ ${testCase.name} -> ${actualType}, amount=${amount}`);
  }
}

const parseCases = [
  ['$1,204.55', 1204.55],
  ['CAD 88.14', 88.14],
  ['USD 42', 42],
  ['CAD 1 208 . 12', 1208.12],
  ['$ 008 : 12', 8.12],
] as const;

for (const [input, expected] of parseCases) {
  const parsed = h.toNumber(input);
  if (parsed === null || Math.abs(parsed - expected) > 0.001) {
    failed += 1;
    console.error(`✗ toNumber failed: input=${input} expected=${expected} actual=${parsed}`);
  } else {
    console.log(`✓ toNumber(${input}) -> ${parsed}`);
  }
}

const fuelDraft = h.parseFuelDraft(
  'STORE 475\n9418 North Interstate 20\nSweetwater, TX 79556\n04/14/2026 Tkt #99242754\nPump: 2\nGallons: 183.682\nPrice / Gal 5.649\nsubtotal 1037.62\nsales Tax 0.00\nTotal 1637.62\nReceived TCHEK 1037.62\nINVOICE# 08887\nDate: 04/14/2026\n$1037.62\nTotal Sale:',
  '2026-04-14-love-475-sweetwater-tx.jpg'
);

if (fuelDraft.gallons !== 183.682 || fuelDraft.amount_usd !== 1037.62 || fuelDraft.vendor?.includes('.jpg')) {
  failed += 1;
  console.error(`✗ parseFuelDraft failed: gallons=${fuelDraft.gallons} amount=${fuelDraft.amount_usd} vendor=${fuelDraft.vendor}`);
} else {
  console.log(`✓ parseFuelDraft actual fuel OCR -> gallons=${fuelDraft.gallons}, amount=${fuelDraft.amount_usd}, vendor=${fuelDraft.vendor}`);
}

const cadCurrency = h.inferCurrency('Transaction 2026-04-05\n81 Ube Drive\nSarnia, Ontario\nAmt/Vol 701.6 L', 'Sarnia, Ontario');
if (cadCurrency !== 'CAD') {
  failed += 1;
  console.error(`✗ inferCurrency failed: expected=CAD actual=${cadCurrency}`);
} else {
  console.log(`✓ inferCurrency Ontario fallback -> ${cadCurrency}`);
}

const dateCases = [
  ['Date 04 . 16 . 2026', '2026-04-16'],
  ['Date 2026-04-16', '2026-04-16'],
  ['Date Apr. 16, 26', '2026-04-16'],
] as const;

for (const [input, expected] of dateCases) {
  const parsed = h.parseDate(input);
  if (parsed !== expected) {
    failed += 1;
    console.error(`✗ parseDate failed: input=${input} expected=${expected} actual=${parsed}`);
  } else {
    console.log(`✓ parseDate(${input}) -> ${parsed}`);
  }
}

const missingCases = [
  { type: 'fuel' as const, data: { date: '2026-04-10', amount_usd: 87.22 }, expected: [] as string[] },
  { type: 'fuel' as const, data: { date: '2026-04-10' }, expected: ['amount_usd'] },
  { type: 'other' as const, data: { date: '2026-04-10', amount_usd: 18.25 }, expected: [] as string[] },
  { type: 'itinerary' as const, data: { route: 'TX -> ON' }, expected: ['trip_number'] },
];

for (const testCase of missingCases) {
  const missing = h.getMissingFields(testCase.type, testCase.data as any);
  const ok = JSON.stringify(missing) === JSON.stringify(testCase.expected);
  if (!ok) {
    failed += 1;
    console.error(`✗ missing-fields failed: type=${testCase.type} expected=${JSON.stringify(testCase.expected)} actual=${JSON.stringify(missing)}`);
  } else {
    console.log(`✓ missing-fields(${testCase.type}) -> ${JSON.stringify(missing)}`);
  }
}

const uploaderSource = readFileSync(join(process.cwd(), 'src/app/dispatch/PdfUploader.tsx'), 'utf8');
if (!uploaderSource.includes('AbortController') || !uploaderSource.includes('onOpenChange={handleReviewDialogChange}')) {
  failed += 1;
  console.error('✗ Process Again integration check failed: PdfUploader is missing abortable close/cancel flow.');
} else {
  console.log('✓ Process Again integration check -> abortable close/cancel flow present.');
}

const adminUtilitySource = readFileSync(join(process.cwd(), 'src/app/dispatch/admin/AdminModelTestUtility.tsx'), 'utf8');
if (!adminUtilitySource.includes('classificationConfidence') || !adminUtilitySource.includes('classificationStage')) {
  failed += 1;
  console.error('✗ Admin dry-run visibility check failed: classification confidence/stage are not surfaced.');
} else {
  console.log('✓ Admin dry-run visibility check -> confidence/stage surfaced.');
}

if (failed > 0) {
  console.error(`\nSmart intake deterministic checks failed (${failed}).`);
  process.exit(1);
}

console.log('\nAll smart intake deterministic checks passed.');
