function isValidPhone(phone) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return digits.length >= 9 && digits.length <= 11 && digits.startsWith("0");
}

const clean = (v) => (v || "").replace(/^\uFEFF/, "").trim();

async function sendNotificationEmail({ name, phone, source }) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const to = clean(process.env.LEAD_NOTIFY_EMAIL);
  if (!apiKey || !to) return { skipped: true };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "한국사업자성장연구소 <onboarding@resend.dev>",
      to: [to],
      subject: `[상담 신청] ${name}님`,
      text: `새 상담 신청이 접수됐습니다.\n\n이름: ${name}\n연락처: ${phone}\n출처: ${source}\n접수 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    }),
  });
  return { skipped: false, ok: res.ok, status: res.status };
}

async function getCachedKakaoToken(kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return null;
  try {
    const r = await fetch(`${kvUrl}/get/kakao_access_token`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = await r.json();
    return data.result || null;
  } catch (e) {
    return null;
  }
}

function cacheKakaoToken(kvUrl, kvToken, accessToken, ttlSeconds) {
  if (!kvUrl || !kvToken) return;
  fetch(`${kvUrl}/set/kakao_access_token/${encodeURIComponent(accessToken)}?EX=${ttlSeconds}`, {
    headers: { Authorization: `Bearer ${kvToken}` },
  }).catch(() => {});
}

async function refreshKakaoToken({ restApiKey, clientSecret, refreshToken }) {
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: restApiKey,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) return null;
  return { accessToken: tokenData.access_token, expiresIn: tokenData.expires_in || 21599 };
}

async function sendKakaoNotification({ name, phone, source }) {
  const restApiKey = clean(process.env.KAKAO_REST_API_KEY);
  const clientSecret = clean(process.env.KAKAO_CLIENT_SECRET);
  const refreshToken = clean(process.env.KAKAO_REFRESH_TOKEN);
  if (!restApiKey || !clientSecret || !refreshToken) return { skipped: true };

  const kvUrl = clean(process.env.KV_REST_API_URL);
  const kvToken = clean(process.env.KV_REST_API_TOKEN);

  const templateObject = {
    object_type: "text",
    text: `[상담 신청]\n이름: ${name}\n연락처: ${phone}\n출처: ${source}\n접수 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    link: {
      web_url: "https://kbgl-kr.vercel.app/",
      mobile_web_url: "https://kbgl-kr.vercel.app/",
    },
  };

  async function sendWith(accessToken) {
    return fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
    });
  }

  let accessToken = await getCachedKakaoToken(kvUrl, kvToken);

  if (accessToken) {
    const sendRes = await sendWith(accessToken);
    if (sendRes.ok) return { ok: true, stage: "send", status: sendRes.status, cached: true };
    if (sendRes.status !== 401) return { ok: false, stage: "send", status: sendRes.status };
    // cached token was rejected (expired/revoked) — fall through to refresh
  }

  const fresh = await refreshKakaoToken({ restApiKey, clientSecret, refreshToken });
  if (!fresh) return { ok: false, stage: "refresh" };
  cacheKakaoToken(kvUrl, kvToken, fresh.accessToken, Math.max(60, fresh.expiresIn - 300));

  const sendRes = await sendWith(fresh.accessToken);
  return { ok: sendRes.ok, stage: "send", status: sendRes.status, cached: false };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const name = (body.name || "").toString().trim().slice(0, 40);
  const phone = (body.phone || "").toString().trim().slice(0, 20);
  const consent = body.consent === true;
  const source = (body.source || "unknown").toString().slice(0, 40);

  if (!name || !isValidPhone(phone) || !consent) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  const url = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);

  try {
    const insertRes = await fetch(`${url}/rest/v1/leads`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ name, phone, consent, source }),
    });

    if (!insertRes.ok) {
      res.status(502).json({ error: "save failed" });
      return;
    }

    await Promise.allSettled([
      sendNotificationEmail({ name, phone, source }),
      sendKakaoNotification({ name, phone, source }),
    ]);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
