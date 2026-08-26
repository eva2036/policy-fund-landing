import { createHash } from "node:crypto";

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
  const now = Date.now();
  const startAtRaw = parseInt(body.startAt, 10);
  // 클라이언트가 보낸 접속 시작 시각을 우선 사용, 비정상 값이면 서버 도착시각 - 체류시간으로 추정
  const arrivedAt = (startAtRaw && Math.abs(now - startAtRaw) < 24 * 3600 * 1000)
    ? startAtRaw
    : now - dwell * 1000;

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

  // V1.0 -> V2.0 승격(2026-08-26) 이후부터 버전별로 통계를 구분해서 비교할 수 있도록 키 접두사를 분리.
  // 버전 태그가 없는 과거 페이지는 계속 기존(레거시=V1) 키를 사용.
  const p = body.version === "v2" ? "v2_" : "";

  function redisCmd(cmd) {
    return fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
  }

  // 같은 IP의 중복 집계 방지: 원본 IP는 저장하지 않고, 비밀 salt로 해시한 값만 24시간 동안 임시로 기억해서
  // "오늘 이미 방문한 IP인지"만 판단한다 (해시는 되돌릴 수 없고, 자동으로 만료됨).
  const ipRaw = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
  const salt = process.env.STATS_SECRET || "kbgl-dedup-fallback-salt";
  if (ipRaw) {
    const ipHash = createHash("sha256").update(`${ipRaw}:${salt}`).digest("hex").slice(0, 32);
    const dedupKey = `${p}seen_ip:${today}:${ipHash}`;
    try {
      const setRes = await redisCmd(["SET", dedupKey, "1", "NX", "EX", "90000"]);
      const setData = await setRes.json();
      if (setData.result !== "OK") {
        // 오늘 이미 집계된 IP — 중복 집계하지 않고 조용히 종료
        res.status(200).json({ ok: true, deduped: true });
        return;
      }
    } catch (e) {
      // dedup 체크 실패 시에도 집계 자체는 계속 진행 (안전한 기본 동작)
    }
  }

  const thresholds = [25, 50, 75, 100].filter((t) => maxScroll >= t);
  const ops = [
    fetch(`${url}/incr/${p}visits:${today}`, { headers: auth }),
    fetch(`${url}/incrby/${p}dwell_total:${today}/${dwell}`, { headers: auth }),
    fetch(`${url}/incr/${p}dwell_count:${today}`, { headers: auth }),
    fetch(`${url}/incr/${p}geo_country:${encodeURIComponent(country)}`, { headers: auth }),
    fetch(`${url}/incr/${p}device:${device}`, { headers: auth }),
    fetch(`${url}/incr/${p}browser:${browser}`, { headers: auth }),
    fetch(`${url}/incr/${p}os:${os}`, { headers: auth }),
    fetch(`${url}/incr/${p}source:${encodeURIComponent(source)}`, { headers: auth }),
    fetch(`${url}/incr/${p}screen:${encodeURIComponent(screen)}`, { headers: auth }),
    fetch(`${url}/incr/${p}lang:${encodeURIComponent(lang)}`, { headers: auth }),
    ...thresholds.map((t) => fetch(`${url}/incr/${p}scroll_${t}:${today}`, { headers: auth })),
  ];
  if (city !== "unknown") {
    ops.push(fetch(`${url}/incr/${p}geo_city:${encodeURIComponent(country + " " + city)}`, { headers: auth }));
  }
  if (utmSource) {
    ops.push(fetch(`${url}/incr/${p}utm_source:${encodeURIComponent(utmSource)}`, { headers: auth }));
  }
  if (utmCampaign) {
    ops.push(fetch(`${url}/incr/${p}utm_campaign:${encodeURIComponent(utmCampaign)}`, { headers: auth }));
  }

  // 방문자 1건씩 개별 기록 (익명, 개인식별정보 없음) — 통계 페이지에서 방문별로 표시하기 위함
  const record = JSON.stringify({
    t: arrivedAt,
    scroll: maxScroll,
    dwell: dwell,
    country: country,
    city: city,
    device: device,
    browser: browser,
    os: os,
    source: source,
  });
  ops.push(redisCmd(["LPUSH", `${p}visit_log:${today}`, record]));
  ops.push(redisCmd(["LTRIM", `${p}visit_log:${today}`, "0", "299"]));

  try {
    await Promise.allSettled(ops);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
