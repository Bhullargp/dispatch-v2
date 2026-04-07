import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/ownership';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const formData = await request.formData();
    const file = formData.get('avatar') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Only JPEG, PNG, WebP, GIF allowed' }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Max 2MB' }, { status: 400 });

    const userId = access.session.userId;
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop() || 'jpg';
    const key = `avatars/${userId}/profile_${Date.now()}.${ext}`;

    const client = createR2Client();
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    }));

    const user = await db().get('SELECT avatar_url FROM users WHERE id = $1', [userId]) as any;
    if (user?.avatar_url && user.avatar_url.includes('avatars/')) {
      try {
        const oldKey = user.avatar_url.split('.cloudflarestorage.com/').pop() || user.avatar_url.split(`dispatch-pdfs/`).pop();
        if (oldKey) await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: oldKey }));
      } catch {}
    }

    await db().run('UPDATE users SET avatar_url = $1 WHERE id = $2', [key, userId]);

    return NextResponse.json({ success: true, avatarKey: key });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const user = await db().get('SELECT avatar_url FROM users WHERE id = $1', [access.session.userId]) as any;

    if (!user?.avatar_url) return NextResponse.json({ avatar: null });

    const client = createR2Client();
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: user.avatar_url,
    }), { expiresIn: 3600 });

    return NextResponse.json({ avatar: url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const user = await db().get('SELECT avatar_url FROM users WHERE id = $1', [access.session.userId]) as any;

    if (user?.avatar_url) {
      try {
        const client = createR2Client();
        await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: user.avatar_url }));
      } catch {}
    }

    await db().run('UPDATE users SET avatar_url = $1 WHERE id = $2', ['', access.session.userId]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
