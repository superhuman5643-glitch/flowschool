import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, fileType, fileBase64 } = req.body;
  if (!userId || !fileBase64) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Ensure avatars bucket exists
    const { data: buckets } = await sb.storage.listBuckets();
    if (!(buckets || []).some(b => b.name === 'avatars')) {
      await sb.storage.createBucket('avatars', { public: true });
    }

    const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer     = Buffer.from(base64Data, 'base64');
    const ext        = (fileType || 'image/jpeg').split('/')[1] || 'jpg';
    const path       = `${userId}/avatar.${ext}`;

    await sb.storage.from('avatars').upload(path, buffer, {
      contentType: fileType || 'image/jpeg',
      upsert: true
    });

    const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
    const url = urlData.publicUrl + '?t=' + Date.now(); // cache-bust

    // Save URL to child_profiles
    await sb.from('child_profiles').upsert(
      { user_id: userId, avatar_url: url },
      { onConflict: 'user_id' }
    );

    res.json({ url });
  } catch (err) {
    console.error('upload-avatar error:', err);
    res.status(500).json({ error: err.message });
  }
}
