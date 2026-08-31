export const config = { maxDuration: 60 };

const clean = (v) => (v || "").replace(/^﻿/, "").trim();

async function getThreadsAuth(kvUrl, kvToken) {
  const auth = { Authorization: `Bearer ${kvToken}` };
  const [tokenRes, userIdRes] = await Promise.all([
    fetch(`${kvUrl}/get/threads_access_token`, { headers: auth }),
    fetch(`${kvUrl}/get/threads_user_id`, { headers: auth }),
  ]);
  const [tokenData, userIdData] = await Promise.all([tokenRes.json(), userIdRes.json()]);
  return { accessToken: tokenData.result || null, userId: userIdData.result || null };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForContainerReady(creationId, accessToken) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(
      `https://graph.threads.net/v1.0/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(accessToken)}`
    );
    const data = await r.json();
    if (data.status === "FINISHED") return { ready: true };
    if (data.status === "ERROR") return { ready: false, detail: data };
    await sleep(1000);
  }
  return { ready: false, detail: { error: { message: "container status polling timed out" } } };
}

async function publishToThreads(userId, accessToken, text) {
  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(text)}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) return { ok: false, stage: "create", detail: createData };

  const readiness = await waitForContainerReady(createData.id, accessToken);
  if (!readiness.ready) return { ok: false, stage: "container_wait", detail: readiness.detail };

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${createData.id}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) return { ok: false, stage: "publish", detail: publishData };

  return { ok: true, threadPostId: publishData.id };
}

function summarizeFailure(result) {
  const d = result && result.detail;
  const msg =
    (d && d.error && (d.error.error_user_msg || d.error.message)) ||
    (d && d.message) ||
    JSON.stringify(d || {});
  return `[${result.stage}] ${msg}`.slice(0, 500);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

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

  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);
  const kvUrl = clean(process.env.KV_REST_API_URL);
  const kvToken = clean(process.env.KV_REST_API_TOKEN);

  try {
    const getRes = await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}&select=id,content,status`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const rows = await getRes.json();
    if (!getRes.ok || !rows.length) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    const post = rows[0];
    if (post.status === "published") {
      res.status(409).json({ error: "already published" });
      return;
    }

    const { accessToken, userId } = await getThreadsAuth(kvUrl, kvToken);
    if (!accessToken || !userId) {
      res.status(500).json({ error: "threads auth not configured" });
      return;
    }

    const result = await publishToThreads(userId, accessToken, post.content);

    const patchHeaders = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    if (result.ok) {
      await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}`, {
        method: "PATCH",
        headers: patchHeaders,
        body: JSON.stringify({
          status: "published",
          published_at: new Date().toISOString(),
          thread_post_id: result.threadPostId,
        }),
      });
      res.status(200).json({ ok: true, published: id, threadPostId: result.threadPostId });
    } else {
      const failReason = summarizeFailure(result);
      console.error("threads publish failed", id, failReason);
      const withReason = await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}`, {
        method: "PATCH",
        headers: patchHeaders,
        body: JSON.stringify({ status: "failed", fail_reason: failReason }),
      });
      if (!withReason.ok) {
        await fetch(`${supabaseUrl}/rest/v1/thread_posts?id=eq.${id}`, {
          method: "PATCH",
          headers: patchHeaders,
          body: JSON.stringify({ status: "failed" }),
        });
      }
      res.status(502).json({ ok: false, failed: id, result, failReason });
    }
  } catch (e) {
    res.status(500).json({ error: "server error", detail: String(e) });
  }
}
