export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
  const type = ["kakao", "form", "consult"].includes(body.type) ? body.type : "kakao";
  const p = body.version === "v2" ? "v2_" : "";

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  try {
    await fetch(`${url}/incr/${p}${type}_clicks:${today}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
