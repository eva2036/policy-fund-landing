const clean = (v) => (v || "").replace(/^﻿/, "").trim();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const secret = clean(process.env.SETUP_SECRET);
  if (!secret || req.query.key !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const accessToken = (body.accessToken || "").toString();
  const userId = (body.userId || "").toString();
  const expiresIn = parseInt(body.expiresIn, 10) || 5184000;

  if (!accessToken || !userId) {
    res.status(400).json({ error: "accessToken and userId required" });
    return;
  }

  const kvUrl = clean(process.env.KV_REST_API_URL);
  const kvToken = clean(process.env.KV_REST_API_TOKEN);
  const auth = { Authorization: `Bearer ${kvToken}` };
  const expiresAt = Date.now() + expiresIn * 1000;

  try {
    await Promise.all([
      fetch(`${kvUrl}/set/threads_access_token/${encodeURIComponent(accessToken)}`, { headers: auth }),
      fetch(`${kvUrl}/set/threads_user_id/${encodeURIComponent(userId)}`, { headers: auth }),
      fetch(`${kvUrl}/set/threads_expires_at/${expiresAt}`, { headers: auth }),
    ]);
    res.status(200).json({ ok: true, expiresAt: new Date(expiresAt).toISOString() });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
