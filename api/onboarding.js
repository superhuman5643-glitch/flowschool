import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body;

  // POST /api/onboarding { action: 'save', userId, interests, ... }
  if (action === 'save') {
    const {
      userId, interests, strongTopics, weakTopics,
      learningStyle, commStyle, businessDream, goal,
      age, schoolClass, favSubject, hardSubject,
      motivations, concentration, vocabLevel
    } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Build rich learning_notes string for AI context
    const notesParts = [];
    if (age)                 notesParts.push(`Alter: ${age} Jahre`);
    if (schoolClass)         notesParts.push(`Klasse: ${schoolClass}`);
    if (favSubject)          notesParts.push(`Lieblingsfach: ${favSubject}`);
    if (hardSubject)         notesParts.push(`Schwieriges Fach: ${hardSubject}`);
    if (commStyle)           notesParts.push(`Ansprache-Stil: ${commStyle}`);
    if (concentration)       notesParts.push(`Konzentrations-Dauer: ${concentration} Minuten`);
    if (motivations?.length) notesParts.push(`Motivation: ${motivations.join(', ')}`);
    if (businessDream)       notesParts.push(`Business-Traum: ${businessDream}`);
    if (goal)                notesParts.push(`3-Monats-Ziel: ${goal}`);
    if (learningStyle)       notesParts.push(`Lernstil: ${learningStyle}`);
    const notes = notesParts.join(' | ');

    // vocab_level: from questionnaire or derived from class
    const cls   = parseInt(schoolClass, 10) || 6;
    const level = vocabLevel || (cls <= 4 ? 1 : cls <= 7 ? 2 : 3);

    try {
      await sb.from('child_profiles').upsert({
        user_id:            userId,
        interests:          interests || [],
        strong_topics:      strongTopics ? [strongTopics] : [],
        weak_topics:        weakTopics  ? [weakTopics]   : [],
        preferred_examples: interests   || [],
        learning_notes:     notes,
        vocab_level:        level,
      }, { onConflict: 'user_id' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/onboarding { action: 'reset', email }
  if (action === 'reset') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const user = list?.users?.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await sb.from('child_profiles')
      .update({ interests: [], learning_notes: '', strong_topics: [], weak_topics: [], preferred_examples: [] })
      .eq('user_id', user.id);

    return res.json({ ok: true, userId: user.id });
  }

  // POST /api/onboarding { action: 'get-children', parentId }
  if (action === 'get-children') {
    const { parentId } = req.body;
    if (!parentId) return res.status(400).json({ error: 'Missing parentId' });

    const { data: links, error: linksError } = await sb
      .from('parent_child_links')
      .select('child_id, nickname')
      .eq('parent_id', parentId);

    if (linksError) return res.status(500).json({ error: linksError.message });
    if (!links || links.length === 0) return res.json({ children: [] });

    // Fetch names from auth metadata (most reliable — display_name set at registration)
    const { data: authList } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const authUsers = authList?.users || [];

    const children = links.map(link => {
      const authUser = authUsers.find(u => u.id === link.child_id);
      const rawName  = authUser?.user_metadata?.display_name
        || authUser?.email?.split('@')[0]
        || 'Kind';
      const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      return {
        id:          link.child_id,
        email:       authUser?.email || '',
        displayName: link.nickname || displayName
      };
    });

    return res.json({ children });
  }

  // POST /api/onboarding { action: 'link-child', parentId, childEmail, nickname }
  if (action === 'link-child') {
    const { parentId, childEmail, nickname } = req.body;
    if (!parentId || !childEmail) return res.status(400).json({ error: 'Missing fields' });

    // Look up child via auth.users (works even if not in users table)
    const { data: authList } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const childAuth = (authList?.users || []).find(
      u => u.email?.toLowerCase() === childEmail.toLowerCase().trim()
    );
    if (!childAuth) return res.status(404).json({ error: 'Kind nicht gefunden. Bitte erst registrieren lassen.' });

    // Check it's not a parent account
    const { data: childRow } = await sb.from('users').select('role').eq('id', childAuth.id).maybeSingle();
    if (childRow?.role === 'parent') return res.status(400).json({ error: 'Das ist ein Eltern-Konto, kein Kind-Konto.' });

    // Ensure child is in users table FIRST (foreign key may be needed)
    await sb.from('users').upsert(
      { id: childAuth.id, email: childAuth.email, role: 'lenny' },
      { onConflict: 'id' }
    );

    // Insert link — check error explicitly (SDK v2 does NOT throw on DB errors)
    const { error: insertError } = await sb
      .from('parent_child_links')
      .insert({ parent_id: parentId, child_id: childAuth.id, nickname: nickname || null });

    if (insertError) {
      if (insertError.code === '23505') return res.status(409).json({ error: 'Kind ist bereits verlinkt.' });
      return res.status(500).json({ error: insertError.message });
    }

    return res.json({ ok: true });
  }

  // POST /api/onboarding { action: 'register', userId, email, role }
  if (action === 'register') {
    const { userId, email, role } = req.body;
    if (!userId || !email) return res.status(400).json({ error: 'Missing fields' });
    try {
      await sb.from('users').upsert(
        { id: userId, email, role: role || 'lenny' },
        { onConflict: 'id' }
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: 'Unknown action' });
}
