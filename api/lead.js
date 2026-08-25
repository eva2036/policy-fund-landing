function isValidPhone(phone) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return digits.length >= 9 && digits.length <= 11 && digits.startsWith("0");
}

async function sendNotificationEmail({ name, phone, source }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL;
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

  const clean = (v) => (v || "").replace(/^\uFEFF/, "").trim();
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

    sendNotificationEmail({ name, phone, source }).catch(() => {});

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
