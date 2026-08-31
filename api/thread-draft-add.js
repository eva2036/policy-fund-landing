const clean = (v) => (v || "").replace(/^﻿/, "").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const cronSecret = clean(process.env.CRON_SECRET);
  const authHeader = req.headers.authorization || "";
  const queryKey = clean(req.query.key);
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && queryKey !== cronSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) {
    res.status(400).json({ error: "missing items array" });
    return;
  }

  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);

  const rows = items
    .map((it) => (typeof it === "string" ? it : it.content))
    .filter(Boolean)
    .map((content) => ({ content, status: "draft" }));

  if (!rows.length) {
    res.status(400).json({ error: "no valid content in items" });
    return;
  }

  try {
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/thread_posts`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rows),
    });
    const data = await insertRes.json();
    if (!insertRes.ok) {
      res.status(502).json({ error: "supabase insert failed", detail: data });
      return;
    }
    res.status(200).json({ ok: true, inserted: data.length, ids: data.map((r) => r.id) });
  } catch (e) {
    res.status(500).json({ error: "server error", detail: String(e) });
  }
}
