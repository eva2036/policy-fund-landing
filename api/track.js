function detectDevice(ua) {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobile|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(ua) {
  if (/Edg\//i.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return "safari";
  if (/Firefox\//i.test(ua)) return "firefox";
  return "other";
}

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
  const dwell = Math.min(3600, Math.max(0, parseInt(body.dwell, 10) || 0));

  // 대략적인 지역(국가/도시)만 사용 — 원본 IP는 저장하지 않음
  const country = req.headers["x-vercel-ip-country"] || "unknown";
  const cityRaw = req.headers["x-vercel-ip-city"];
  const city = cityRaw ? decodeURIComponent(cityRaw) : "unknown";

  const ua = req.headers["user-agent"] || "";
  const device = detectDevice(ua);
  const browser = detectBrowser(ua);

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const auth = { Authorization: `Bearer ${token}` };

  const thresholds = [25, 50, 75, 100].filter((t) => maxScroll >= t);
  const ops = [
    fetch(`${url}/incr/visits:${today}`, { headers: auth }),
    fetch(`${url}/incrby/dwell_total:${today}/${dwell}`, { headers: auth }),
    fetch(`${url}/incr/dwell_count:${today}`, { headers: auth }),
    fetch(`${url}/incr/geo_country:${encodeURIComponent(country)}`, { headers: auth }),
    fetch(`${url}/incr/device:${device}`, { headers: auth }),
    fetch(`${url}/incr/browser:${browser}`, { headers: auth }),
    ...thresholds.map((t) => fetch(`${url}/incr/scroll_${t}:${today}`, { headers: auth })),
  ];
  if (city !== "unknown") {
    ops.push(fetch(`${url}/incr/geo_city:${encodeURIComponent(country + " " + city)}`, { headers: auth }));
  }

  try {
    await Promise.allSettled(ops);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
