import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 Configuration interface
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl?: string;
}

// Get R2 configuration from environment variables
function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Missing required R2 configuration. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.');
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

// Create R2/S3 client
function createR2Client(): S3Client {
  const config = getR2Config();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

// Upload file to R2 with per-user isolation
export async function uploadFileToR2(params: {
  userId: number | string;
  file: Buffer;
  filename: string;
  contentType: string;
}): Promise<{ key: string; url: string }> {
  const client = createR2Client();
  const config = getR2Config();

  // Create per-user path: documents/{userId}/{timestamp}_{filename}
  const timestamp = Date.now();
  const sanitizedFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `documents/${params.userId}/${timestamp}_${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: params.file,
    ContentType: params.contentType,
  });

  await client.send(command);

  // Generate URL (either public or presigned)
  const url = config.publicUrl
    ? `${config.publicUrl}/${key}`
    : await getSignedUrl(client, new GetObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      }), { expiresIn: 3600 * 24 * 7 }); // 7 days

  return { key, url };
}

// Download file from R2 as Buffer (used by server-side processing)
export async function downloadFromR2(key: string): Promise<Buffer> {
  const client = createR2Client();
  const config = getR2Config();
  const res = await client.send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }));
  if (!res.Body) throw new Error('File not found in R2');
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Delete a single file from R2 by key (no ownership check — internal use)
export async function deleteFromR2(key: string): Promise<void> {
  const client = createR2Client();
  const config = getR2Config();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }));
}

// Delete all R2 objects under a prefix older than maxAgeDays
export async function deleteOldR2Objects(prefix: string, maxAgeDays: number): Promise<number> {
  const client = createR2Client();
  const config = getR2Config();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const res = await client.send(new ListObjectsV2Command({ Bucket: config.bucketName, Prefix: prefix }));
  const stale = (res.Contents || []).filter(o => o.LastModified && o.LastModified.getTime() < cutoff);
  for (const obj of stale) {
    if (obj.Key) await deleteFromR2(obj.Key);
  }
  return stale.length;
}

// Get file from R2
export async function getFileFromR2(params: {
  userId: number | string;
  key: string;
}): Promise<{ stream: ReadableStream; contentType: string }> {
  const client = createR2Client();
  const config = getR2Config();

  // Security: Ensure the key belongs to the user
  if (!params.key.startsWith(`documents/${params.userId}/`)) {
    throw new Error('Access denied: File does not belong to user');
  }

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: params.key,
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error('File not found');
  }

  return {
    stream: response.Body as ReadableStream,
    contentType: response.ContentType || 'application/octet-stream',
  };
}

// Delete file from R2
export async function deleteFileFromR2(params: {
  userId: number | string;
  key: string;
}): Promise<void> {
  const client = createR2Client();
  const config = getR2Config();

  // Security: Ensure the key belongs to the user
  if (!params.key.startsWith(`documents/${params.userId}/`)) {
    throw new Error('Access denied: File does not belong to user');
  }

  const command = new DeleteObjectCommand({
    Bucket: config.bucketName,
    Key: params.key,
  });

  await client.send(command);
}

// List user's files
export async function listUserFiles(params: {
  userId: number | string;
  maxKeys?: number;
}): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const client = createR2Client();
  const config = getR2Config();

  const command = new ListObjectsV2Command({
    Bucket: config.bucketName,
    Prefix: `documents/${params.userId}/`,
    MaxKeys: params.maxKeys || 100,
  });

  const response = await client.send(command);

  return (response.Contents || []).map(obj => ({
    key: obj.Key!,
    size: obj.Size || 0,
    lastModified: obj.LastModified || new Date(),
  }));
}

// Generate presigned URL for upload (for direct browser uploads)
export async function generateUploadUrl(params: {
  userId: number | string;
  filename: string;
  contentType: string;
  expiresIn?: number;
}): Promise<{ uploadUrl: string; key: string }> {
  const client = createR2Client();
  const config = getR2Config();

  const timestamp = Date.now();
  const sanitizedFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `documents/${params.userId}/${timestamp}_${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    ContentType: params.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: params.expiresIn || 3600 // 1 hour default
  });

  return { uploadUrl, key };
}

// Generate presigned URL for download
export async function generateDownloadUrl(params: {
  userId: number | string;
  key: string;
  expiresIn?: number;
}): Promise<string> {
  const client = createR2Client();
  const config = getR2Config();

  // Security: Ensure the key belongs to the user
  if (!params.key.startsWith(`documents/${params.userId}/`)) {
    throw new Error('Access denied: File does not belong to user');
  }

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: params.key,
  });

  return await getSignedUrl(client, command, {
    expiresIn: params.expiresIn || 3600 // 1 hour default
  });
}

// Check if R2 is configured
export function isR2Configured(): boolean {
  try {
    getR2Config();
    return true;
  } catch {
    return false;
  }
}

