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

function detectOS(ua) {
  if (/Windows/i.test(ua)) return "windows";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mac OS X/i.test(ua)) return "macos";
  if (/Android/i.test(ua)) return "android";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

function categorizeReferrer(ref) {
  if (!ref) return "direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (/instagram\.com/.test(host)) return "instagram";
    if (/naver\.com/.test(host)) return "naver";
    if (/kakao\.com|kakaocorp\.com/.test(host)) return "kakao";
    if (/daangn\.com/.test(host)) return "daangn";
    if (/google\./.test(host)) return "google";
    if (/facebook\.com|fb\.com/.test(host)) return "facebook";
    if (/dable\.io|dabl\.co/.test(host)) return "dable";
    return host.slice(0, 40);
  } catch (e) {
    return "unknown";
  }
}

function screenBucket(w) {
  if (!w) return "unknown";
  if (w < 480) return "~480px";
  if (w < 768) return "480-768px";
  if (w < 1200) return "768-1200px";
  return "1200px+";
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
  const os = detectOS(ua);
  const source = categorizeReferrer(body.ref);
  const screen = screenBucket(parseInt(body.screenW, 10));
  const lang = (body.lang || "unknown").slice(0, 10);
  const utmSource = (body.utmSource || "").slice(0, 40);
  const utmCampaign = (body.utmCampaign || "").slice(0, 40);

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
    fetch(`${url}/incr/os:${os}`, { headers: auth }),
    fetch(`${url}/incr/source:${encodeURIComponent(source)}`, { headers: auth }),
    fetch(`${url}/incr/screen:${encodeURIComponent(screen)}`, { headers: auth }),
    fetch(`${url}/incr/lang:${encodeURIComponent(lang)}`, { headers: auth }),
    ...thresholds.map((t) => fetch(`${url}/incr/scroll_${t}:${today}`, { headers: auth })),
  ];
  if (city !== "unknown") {
    ops.push(fetch(`${url}/incr/geo_city:${encodeURIComponent(country + " " + city)}`, { headers: auth }));
  }
  if (utmSource) {
    ops.push(fetch(`${url}/incr/utm_source:${encodeURIComponent(utmSource)}`, { headers: auth }));
  }
  if (utmCampaign) {
    ops.push(fetch(`${url}/incr/utm_campaign:${encodeURIComponent(utmCampaign)}`, { headers: auth }));
  }

  try {
    await Promise.allSettled(ops);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
