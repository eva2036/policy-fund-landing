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

  const id = clean(req.query.id);
  if (!id) {
    res.status(400).json({ error: "missing id" });
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
  const content = body && typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    res.status(400).json({ error: "missing content" });
    return;
  }

  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);

  try {
    const getRes = await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}&select=id,status`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const rows = await getRes.json();
    if (!getRes.ok || !rows.length) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    if (rows[0].status !== "draft" && rows[0].status !== "pending") {
      res.status(409).json({ error: "not editable", status: rows[0].status });
      return;
    }

    const patchRes = await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ content }),
    });
    if (!patchRes.ok) {
      res.status(502).json({ error: "supabase update failed" });
      return;
    }

    res.status(200).json({ ok: true, edited: id });
  } catch (e) {
    res.status(500).json({ error: "server error", detail: String(e) });
  }
}
