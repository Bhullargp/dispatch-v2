const SUPPORTED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] as const;

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const SUPPORTED_DOCUMENT_ACCEPT = [
  ...SUPPORTED_DOCUMENT_MIME_TYPES,
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
].join(',');

export const SUPPORTED_DOCUMENT_UPLOAD_ERROR = 'Only PDF, JPG, PNG, WebP, and HEIC files are supported';

function getExtension(name: string) {
  const lowerName = String(name || '').toLowerCase();
  const lastDot = lowerName.lastIndexOf('.');
  return lastDot >= 0 ? lowerName.slice(lastDot) : '';
}

export function getDocumentUploadMimeType(file: { name: string; type?: string | null }) {
  const fileType = String(file.type || '').toLowerCase();
  if (SUPPORTED_DOCUMENT_MIME_TYPES.includes(fileType as (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number])) {
    return fileType;
  }

  const extension = getExtension(file.name);
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.heic') return 'image/heic';
  if (extension === '.heif') return 'image/heif';
  return '';
}

export function isSupportedDocumentUpload(file: { name: string; type?: string | null }) {
  return Boolean(getDocumentUploadMimeType(file));
}

export function isPdfDocumentUpload(file: { name: string; type?: string | null }) {
  return getDocumentUploadMimeType(file) === 'application/pdf';
}
