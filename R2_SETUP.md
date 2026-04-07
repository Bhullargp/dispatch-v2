# Cloudflare R2 Integration Guide

This guide explains how to set up Cloudflare R2 storage for document uploads in the Dispatch app.

## What is R2?

Cloudflare R2 is an S3-compatible object storage service with zero egress fees. It's perfect for storing receipts, documents, and other files uploaded by users.

## Setup Instructions

### 1. Create an R2 Bucket

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **R2 > Overview**
3. Click **Create bucket**
4. Enter a bucket name (e.g., `dispatch-documents`)
5. Choose a location (or keep default)
6. Click **Create bucket**

### 2. Create an R2 API Token

1. In the Cloudflare Dashboard, go to **R2 > Overview**
2. Scroll down to **R2 API Tokens**
3. Click **Create API token**
4. Give the token a name (e.g., "Dispatch App Token")
5. Set permissions to:
   - **Object Read & Write** (for full access)
   - Or customize for more granular control
6. Set TTL (Time To Live) - you can use "Never expire" for production
7. Click **Create API token**
8. **Important**: Copy the credentials immediately:
   - Access Key ID
   - Secret Access Key
   - Account ID (shown in the dashboard or in your URL)

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.r2.example .env.local
```

Edit `.env.local` and add your R2 credentials:

```env
R2_ACCOUNT_ID=your_account_id_here
R2_ACCESS_KEY_ID=your_access_key_id_here
R2_SECRET_ACCESS_KEY=your_secret_access_key_here
R2_BUCKET_NAME=dispatch-documents
```

### 4. Optional: Set Up a Custom Domain

If you want public URLs for your files (instead of presigned URLs):

1. Go to **R2 > Your Bucket > Settings**
2. Under **Public Access**, click **Connect Domain**
3. Add your domain (e.g., `files.yourdomain.com`)
4. Update DNS records as instructed
5. Add to `.env.local`:
   ```env
   R2_PUBLIC_URL=https://files.yourdomain.com
   ```

### 5. Install Dependencies

```bash
npm install
```

This installs the required AWS SDK packages:
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`

### 6. Restart Your App

```bash
npm run dev
```

## Features

Once configured, the R2 integration provides:

### Per-User Storage Isolation
- Each user's files are stored in `documents/{userId}/` paths
- Users can only access their own files
- Security checks prevent unauthorized access

### Supported File Types
- PDF documents (receipts, invoices)
- Images: JPEG, PNG, WebP, HEIC, HEIF
- Maximum file size: 50MB

### API Endpoints

#### Upload Documents
- **POST** `/api/dispatch/documents`
- Upload a file with metadata
- Returns file key and URL

#### Generate Upload URL
- **POST** `/api/dispatch/documents/upload-url`
- Get a presigned URL for direct browser-to-R2 upload
- Useful for large files or client-side uploads

#### List Documents
- **GET** `/api/dispatch/documents/list`
- List all documents for the current user
- Optional filter by trip number: `?tripNumber=TRIP001`

#### Download Document
- **GET** `/api/dispatch/documents/download/{key}`
- Download a specific document
- Optional redirect: `?redirect=true`

#### Delete Document
- **DELETE** `/api/dispatch/documents?key={key}`
- Delete a document

#### Confirm Upload
- **POST** `/api/dispatch/documents/confirm`
- Confirm a direct browser upload
- Stores metadata in database

## Usage Example

### Server-side Upload
```typescript
const formData = new FormData();
formData.append('file', file);
formData.append('description', 'Fuel receipt');
formData.append('tripNumber', 'TRIP001');

const response = await fetch('/api/dispatch/documents', {
  method: 'POST',
  body: formData,
});

const { file } = await response.json();
```

### Direct Browser Upload
```typescript
// 1. Get presigned URL
const { uploadUrl, key } = await fetch('/api/dispatch/documents/upload-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: file.name,
    contentType: file.type,
  }),
}).then(r => r.json());

// 2. Upload directly to R2
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});

// 3. Confirm upload
await fetch('/api/dispatch/documents/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key,
    originalFilename: file.name,
    fileType: file.type,
    fileSize: file.size,
    description: 'Fuel receipt',
    tripNumber: 'TRIP001',
  }),
});
```

## Security

- **Per-user isolation**: Files are stored in user-specific paths
- **Access control**: Server validates user permissions
- **File type validation**: Only allowed file types are accepted
- **Size limits**: 50MB maximum file size
- **Presigned URLs**: Time-limited access tokens for direct uploads

## Cost

- **Storage**: ~$0.015/GB/month
- **Class A Operations** (uploads): $4.50 per million requests
- **Class B Operations** (downloads): $0.36 per million requests
- **Zero egress fees**: No charge for downloading files

## Troubleshooting

### "Document storage is not configured"
- Check that all R2 environment variables are set
- Verify the bucket exists in Cloudflare
- Restart the application after changing `.env.local`

### Uploads fail with "Access denied"
- Verify your API token has "Object Read & Write" permissions
- Check that the bucket name matches exactly
- Ensure the Account ID is correct

### Files don't appear
- Check browser console for errors
- Verify the file size is under 50MB
- Ensure the file type is supported

## Testing

You can test the R2 integration by:

1. Uploading a small PDF file
2. Listing documents to verify it appears
3. Downloading the file to confirm it works
4. Checking the R2 bucket in Cloudflare dashboard

## Migration from Local Storage

The existing PDF upload system (`/api/dispatch/upload`) now supports R2 automatically when configured. It falls back to local storage if R2 is not configured.

To migrate existing files:
1. Configure R2
2. Upload new files (they'll go to R2)
3. Optionally migrate existing files manually
4. Update file paths in the database

## Support

For issues with:
- **R2 setup**: Contact Cloudflare support
- **App integration**: Check the GitHub issues or create a new one