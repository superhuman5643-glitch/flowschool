import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type } = req.body;

  // POST /api/upload { type: 'avatar', userId, fileType, fileBase64 }
  if (type === 'avatar') {
    const { userId, fileType, fileBase64 } = req.body;
    if (!userId || !fileBase64) return res.status(400).json({ error: 'Missing fields' });

    try {
      const { data: buckets } = await sb.storage.listBuckets();
      if (!(buckets || []).some(b => b.name === 'avatars')) {
        await sb.storage.createBucket('avatars', { public: true });
      }

      const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const ext  = (fileType || 'image/jpeg').split('/')[1] || 'jpg';
      const path = `${userId}/avatar.${ext}`;

      await sb.storage.from('avatars').upload(path, buffer, {
        contentType: fileType || 'image/jpeg', upsert: true
      });

      const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
      const url = urlData.publicUrl + '?t=' + Date.now();

      await sb.from('child_profiles').upsert(
        { user_id: userId, avatar_url: url },
        { onConflict: 'user_id' }
      );

      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/upload { type: 'photo', userId, challengeId, fileName, fileType, fileBase64 }
  if (type === 'photo') {
    const { userId, challengeId, fileName, fileType, fileBase64 } = req.body;
    if (!userId || !challengeId || !fileBase64) return res.status(400).json({ error: 'Missing fields' });

    try {
      const { data: buckets } = await sb.storage.listBuckets();
      if (!(buckets || []).some(b => b.name === 'challenge-photos')) {
        await sb.storage.createBucket('challenge-photos', { public: true });
      }

      const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const ext  = (fileName || 'photo.jpg').split('.').pop().toLowerCase();
      const safe = ['jpg','jpeg','png','gif','webp'].includes(ext) ? ext : 'jpg';
      const path = `${userId}/${challengeId}/${Date.now()}.${safe}`;

      const { error } = await sb.storage.from('challenge-photos')
        .upload(path, buffer, { contentType: fileType || 'image/jpeg', upsert: true });

      if (error) return res.status(500).json({ error: error.message });

      const { data: urlData } = sb.storage.from('challenge-photos').getPublicUrl(path);
      return res.json({ url: urlData.publicUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: 'Unknown type' });
}
