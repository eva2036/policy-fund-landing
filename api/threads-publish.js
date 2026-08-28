const clean = (v) => (v || "").replace(/^﻿/, "").trim();

async function getThreadsAuth(kvUrl, kvToken) {
  const auth = { Authorization: `Bearer ${kvToken}` };
  const [tokenRes, userIdRes, expiresAtRes] = await Promise.all([
    fetch(`${kvUrl}/get/threads_access_token`, { headers: auth }),
    fetch(`${kvUrl}/get/threads_user_id`, { headers: auth }),
    fetch(`${kvUrl}/get/threads_expires_at`, { headers: auth }),
  ]);
  const [tokenData, userIdData, expiresAtData] = await Promise.all([
    tokenRes.json(), userIdRes.json(), expiresAtRes.json(),
  ]);
  return {
    accessToken: tokenData.result || null,
    userId: userIdData.result || null,
    expiresAt: expiresAtData.result ? parseInt(expiresAtData.result, 10) : 0,
  };
}

function saveThreadsAuth(kvUrl, kvToken, accessToken, expiresAt) {
  const auth = { Authorization: `Bearer ${kvToken}` };
  return Promise.all([
    fetch(`${kvUrl}/set/threads_access_token/${encodeURIComponent(accessToken)}`, { headers: auth }),
    fetch(`${kvUrl}/set/threads_expires_at/${expiresAt}`, { headers: auth }),
  ]);
}

async function refreshThreadsToken(accessToken) {
  const r = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(accessToken)}`
  );
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  return { accessToken: data.access_token, expiresIn: data.expires_in || 5184000 };
}

async function publishToThreads(userId, accessToken, text) {
  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(text)}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    return { ok: false, stage: "create", detail: createData };
  }

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${createData.id}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    return { ok: false, stage: "publish", detail: publishData };
  }

  return { ok: true, threadPostId: publishData.id };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const cronSecret = clean(process.env.CRON_SECRET);
  if (cronSecret) {
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);
  const kvUrl = clean(process.env.KV_REST_API_URL);
  const kvToken = clean(process.env.KV_REST_API_TOKEN);

  try {
    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/thread_posts?status=eq.pending&order=created_at.asc&limit=1`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await listRes.json();
    if (!listRes.ok || !Array.isArray(rows) || rows.length === 0) {
      res.status(200).json({ ok: true, skipped: true, reason: "no pending posts" });
      return;
    }

    const post = rows[0];

    let { accessToken, userId, expiresAt } = await getThreadsAuth(kvUrl, kvToken);
    if (!accessToken || !userId) {
      res.status(500).json({ error: "threads auth not configured" });
      return;
    }

    const fiveDaysMs = 5 * 24 * 3600 * 1000;
    if (expiresAt && expiresAt - Date.now() < fiveDaysMs) {
      const refreshed = await refreshThreadsToken(accessToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        const newExpiresAt = Date.now() + refreshed.expiresIn * 1000;
        await saveThreadsAuth(kvUrl, kvToken, accessToken, newExpiresAt);
      }
    }

    const result = await publishToThreads(userId, accessToken, post.content);

    const patchHeaders = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    if (result.ok) {
      await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${post.id}`, {
        method: "PATCH",
        headers: patchHeaders,
        body: JSON.stringify({
          status: "published",
          published_at: new Date().toISOString(),
          thread_post_id: result.threadPostId,
        }),
      });
      res.status(200).json({ ok: true, published: post.id, threadPostId: result.threadPostId });
    } else {
      await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${post.id}`, {
        method: "PATCH",
        headers: patchHeaders,
        body: JSON.stringify({ status: "failed" }),
      });
      res.status(502).json({ ok: false, failed: post.id, result });
    }
  } catch (e) {
    res.status(500).json({ error: "server error", detail: String(e) });
  }
}
