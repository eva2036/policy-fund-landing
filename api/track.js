export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const maxScroll = Math.min(100, Math.max(0, parseInt(body.maxScroll, 10) || 0));
  const dwell = Math.min(3600, Math.max(0, parseInt(body.dwell, 10) || 0)); // cap at 1h to avoid junk

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const auth = { Authorization: `Bearer ${token}` };

  const thresholds = [25, 50, 75, 100].filter((t) => maxScroll >= t);
  const ops = [
    fetch(`${url}/incr/visits:${today}`, { headers: auth }),
    fetch(`${url}/incrby/dwell_total:${today}/${dwell}`, { headers: auth }),
    fetch(`${url}/incr/dwell_count:${today}`, { headers: auth }),
    ...thresholds.map((t) => fetch(`${url}/incr/scroll_${t}:${today}`, { headers: auth })),
  ];

  try {
    await Promise.allSettled(ops);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
