import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const action = req.method === 'GET' ? req.query.action : req.body?.action;

  // ── GET: list all subjects + which ones a child has ──
  if (action === 'list') {
    const childId = req.query.childId;
    if (!childId) return res.status(400).json({ error: 'Missing childId' });

    // All available subjects (default + created by any parent for this child)
    const { data: allSubjects, error: subErr } = await sb
      .from('subjects')
      .select('id, name, emoji, sort_order, is_mandatory, created_by')
      .order('sort_order');
    if (subErr) return res.status(500).json({ error: subErr.message });

    // Which subjects this child has configured
    const { data: childSubs } = await sb
      .from('child_subjects')
      .select('subject_id, sort_order')
      .eq('user_id', childId);

    const childSubIds = new Set((childSubs || []).map(s => s.subject_id));
    const hasCustomConfig = (childSubs || []).length > 0;

    // Mark each subject as active for this child
    const subjects = (allSubjects || []).map(s => ({
      ...s,
      active: hasCustomConfig ? childSubIds.has(s.id) : s.is_mandatory
    }));

    return res.json({ subjects, hasCustomConfig });
  }

  // ── POST actions ──
  if (req.method !== 'POST') return res.status(405).end();
  const { childId, parentId } = req.body;

  // Save which subjects a child should see
  if (action === 'save-child-subjects') {
    const { subjectIds } = req.body;
    if (!childId || !Array.isArray(subjectIds)) return res.status(400).json({ error: 'Missing fields' });

    // Delete existing config for this child
    await sb.from('child_subjects').delete().eq('user_id', childId);

    // Insert new config
    if (subjectIds.length > 0) {
      const rows = subjectIds.map((id, i) => ({ user_id: childId, subject_id: id, sort_order: i }));
      const { error: insertErr } = await sb.from('child_subjects').insert(rows);
      if (insertErr) return res.status(500).json({ error: insertErr.message });
    }

    return res.json({ ok: true });
  }

  // Create a brand-new custom subject + optionally add to child
  if (action === 'create-subject') {
    const { name, emoji, addToChildId } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });

    // Get max sort_order
    const { data: maxRow } = await sb.from('subjects').select('sort_order').order('sort_order', { ascending: false }).limit(1).single();
    const nextOrder = (maxRow?.sort_order || 0) + 1;

    const { data: newSubject, error: createErr } = await sb
      .from('subjects')
      .insert({ name, emoji: emoji || '📖', sort_order: nextOrder, is_mandatory: false, is_default: false, created_by: parentId || null })
      .select()
      .single();

    if (createErr) return res.status(500).json({ error: createErr.message });

    // Optionally add to a specific child right away
    if (addToChildId) {
      // If child has no custom config yet, seed it with their current mandatory subjects first
      const { data: existingConfig } = await sb.from('child_subjects').select('id').eq('user_id', addToChildId).limit(1);
      if (!existingConfig || existingConfig.length === 0) {
        // Seed from mandatory subjects
        const { data: mandatory } = await sb.from('subjects').select('id, sort_order').eq('is_mandatory', true).order('sort_order');
        const seedRows = (mandatory || []).map((s, i) => ({ user_id: addToChildId, subject_id: s.id, sort_order: i }));
        if (seedRows.length > 0) await sb.from('child_subjects').insert(seedRows);
      }
      // Now add the new subject
      const { data: maxCs } = await sb.from('child_subjects').select('sort_order').eq('user_id', addToChildId).order('sort_order', { ascending: false }).limit(1).single();
      await sb.from('child_subjects').insert({ user_id: addToChildId, subject_id: newSubject.id, sort_order: (maxCs?.sort_order || 0) + 1 });
    }

    return res.json({ ok: true, subject: newSubject });
  }

  // Seed mandatory subjects into child_subjects (called when parent first opens the manager)
  if (action === 'seed-child-subjects') {
    if (!childId) return res.status(400).json({ error: 'Missing childId' });

    const { data: existing } = await sb.from('child_subjects').select('id').eq('user_id', childId).limit(1);
    if (existing && existing.length > 0) return res.json({ ok: true, alreadySeeded: true });

    const { data: mandatory } = await sb.from('subjects').select('id, sort_order').eq('is_mandatory', true).order('sort_order');
    const rows = (mandatory || []).map((s, i) => ({ user_id: childId, subject_id: s.id, sort_order: i }));
    if (rows.length > 0) {
      const { error } = await sb.from('child_subjects').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, seeded: rows.length });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
