import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, challengeId, fileName, fileType, fileBase64 } = req.body;
  if (!userId || !challengeId || !fileBase64) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    // Ensure bucket exists
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = (buckets || []).some(b => b.name === 'challenge-photos');
    if (!exists) {
      await sb.storage.createBucket('challenge-photos', { public: true });
    }

    // Decode base64 to buffer
    const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const ext  = (fileName || 'photo.jpg').split('.').pop().toLowerCase();
    const safe = ['jpg','jpeg','png','gif','webp'].includes(ext) ? ext : 'jpg';
    const path = `${userId}/${challengeId}/${Date.now()}.${safe}`;

    const { error } = await sb.storage
      .from('challenge-photos')
      .upload(path, buffer, { contentType: fileType || 'image/jpeg', upsert: true });

    if (error) {
      console.error('Storage upload error:', error);
      return res.status(500).json({ error: error.message });
    }

    const { data: urlData } = sb.storage.from('challenge-photos').getPublicUrl(path);
    res.json({ url: urlData.publicUrl });

  } catch (err) {
    console.error('upload-photo error:', err);
    res.status(500).json({ error: err.message });
  }
}
