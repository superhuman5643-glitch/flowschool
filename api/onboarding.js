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

  // ── Subjects management ──

  // POST { action: 'list-subjects', childId }
  if (action === 'list-subjects') {
    const { childId } = req.body;
    if (!childId) return res.status(400).json({ error: 'Missing childId' });

    const { data: allSubjects, error: subErr } = await sb
      .from('subjects')
      .select('id, name, emoji, sort_order, is_mandatory, created_by')
      .order('sort_order');
    if (subErr) return res.status(500).json({ error: subErr.message });

    const { data: childSubs } = await sb
      .from('child_subjects').select('subject_id, sort_order').eq('user_id', childId);

    const childSubIds = new Set((childSubs || []).map(s => s.subject_id));
    const hasCustomConfig = (childSubs || []).length > 0;

    const subjects = (allSubjects || []).map(s => ({
      ...s,
      active: hasCustomConfig ? childSubIds.has(s.id) : s.is_mandatory
    }));

    return res.json({ subjects, hasCustomConfig });
  }

  // POST { action: 'save-child-subjects', childId, subjectIds }
  if (action === 'save-child-subjects') {
    const { childId, subjectIds } = req.body;
    if (!childId || !Array.isArray(subjectIds)) return res.status(400).json({ error: 'Missing fields' });

    await sb.from('child_subjects').delete().eq('user_id', childId);
    if (subjectIds.length > 0) {
      const rows = subjectIds.map((id, i) => ({ user_id: childId, subject_id: id, sort_order: i }));
      const { error: insertErr } = await sb.from('child_subjects').insert(rows);
      if (insertErr) return res.status(500).json({ error: insertErr.message });
    }
    return res.json({ ok: true });
  }

  // POST { action: 'create-subject', name, emoji, parentId, addToChildId }
  if (action === 'create-subject') {
    const { name, emoji, parentId, addToChildId } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const { data: maxRow } = await sb.from('subjects').select('sort_order')
      .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const nextOrder = (maxRow?.sort_order || 0) + 1;

    const { data: newSubject, error: createErr } = await sb
      .from('subjects')
      .insert({ name, emoji: emoji || '📖', sort_order: nextOrder, is_mandatory: false, is_default: false, created_by: parentId || null })
      .select().single();
    if (createErr) return res.status(500).json({ error: createErr.message });

    if (addToChildId) {
      const { data: existingConfig } = await sb.from('child_subjects').select('id').eq('user_id', addToChildId).limit(1);
      if (!existingConfig || existingConfig.length === 0) {
        const { data: mandatory } = await sb.from('subjects').select('id, sort_order').eq('is_mandatory', true).order('sort_order');
        const seedRows = (mandatory || []).map((s, i) => ({ user_id: addToChildId, subject_id: s.id, sort_order: i }));
        if (seedRows.length > 0) await sb.from('child_subjects').insert(seedRows);
      }
      const { data: maxCs } = await sb.from('child_subjects').select('sort_order')
        .eq('user_id', addToChildId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
      await sb.from('child_subjects').insert({ user_id: addToChildId, subject_id: newSubject.id, sort_order: (maxCs?.sort_order || 0) + 1 });
    }
    return res.json({ ok: true, subject: newSubject });
  }

  // POST { action: 'delete-subject', subjectId, parentId }
  if (action === 'delete-subject') {
    const { subjectId, parentId } = req.body;
    if (!subjectId) return res.status(400).json({ error: 'Missing subjectId' });

    // Only allow deletion of custom subjects created by this parent
    const { data: subject } = await sb.from('subjects').select('created_by').eq('id', subjectId).maybeSingle();
    if (!subject) return res.status(404).json({ error: 'Thema nicht gefunden' });
    if (!subject.created_by) return res.status(403).json({ error: 'Standard-Themen können nicht gelöscht werden' });
    if (parentId && subject.created_by !== parentId) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Remove from all child_subjects first (FK), then delete subject
    await sb.from('child_subjects').delete().eq('subject_id', subjectId);
    const { error: delErr } = await sb.from('subjects').delete().eq('id', subjectId);
    if (delErr) return res.status(500).json({ error: delErr.message });

    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
}
