import { getUpcomingSlots } from "./_cron-schedule.js";

const clean = (v) => (v || "").replace(/^﻿/, "").trim();

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtKstDate(d) {
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
}
function fmtKstTime(d) {
  return d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
}
function fmtKstDateTime(d) {
  return `${fmtKstDate(d)} ${fmtKstTime(d)}`;
}

function groupByDate(posts, dateOf) {
  const groups = [];
  posts.forEach((p) => {
    const label = dateOf(p);
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, items: [] };
      groups.push(group);
    }
    group.items.push(p);
  });
  return groups;
}

// Where would this draft land if approved right now? Merge it into the
// existing pending queue by created_at and find its position.
function predictSlotForDraft(draft, pending, allSlots) {
  const merged = [...pending.map((p) => ({ id: p.id, created_at: p.created_at })), { id: draft.id, created_at: draft.created_at }].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  const idx = merged.findIndex((x) => x.id === draft.id);
  return allSlots[idx] || null;
}

function editableCard(p, extraTag, extraBtns) {
  return `
      <div class="card ${p.status === "draft" ? "draft" : "pendingcard"}" data-id="${escapeHtml(p.id)}">
        <div class="row1">
          ${extraTag}
          <div class="btns">
            ${extraBtns}
            <button class="pub-btn edit" onclick="toggleEdit('${escapeHtml(p.id)}', this)">✏️ 수정</button>
          </div>
        </div>
        <div class="content" id="content-${escapeHtml(p.id)}">${escapeHtml(p.content).replace(/\n/g, "<br>")}</div>
        <textarea class="edit-area" id="edit-${escapeHtml(p.id)}" style="display:none">${escapeHtml(p.content)}</textarea>
        <div class="edit-btns" id="editbtns-${escapeHtml(p.id)}" style="display:none">
          <button class="pub-btn save" onclick="saveEdit('${escapeHtml(p.id)}', this)">저장</button>
          <button class="pub-btn cancel" onclick="toggleEdit('${escapeHtml(p.id)}', this)">취소</button>
        </div>
      </div>`;
}

function renderPage(drafts, pending, recent, research, key) {
  const allSlots = getUpcomingSlots(pending.length + drafts.length);

  const pendingWithSlot = pending.map((p, i) => ({
    post: p,
    time: allSlots[i] ? fmtKstTime(allSlots[i]) : "-",
    dateLabel: allSlots[i] ? fmtKstDate(allSlots[i]) : "예정 슬롯 부족 (스케줄 확장 필요)",
    isNext: i === 0,
  }));
  const pendingGroups = groupByDate(pendingWithSlot, (it) => it.dateLabel);

  const draftGroups = groupByDate(drafts, (p) => fmtKstDate(new Date(p.created_at)));

  const draftsHtml = draftGroups.length
    ? draftGroups
        .map(
          (g, gi) => `
        <details class="daygroup" ${gi === draftGroups.length - 1 ? "open" : ""}>
          <summary class="daylabel">${escapeHtml(g.label)} <span class="cnt">${g.items.length}건</span></summary>
          ${g.items
            .map((p) => {
              const slot = predictSlotForDraft(p, pending, allSlots);
              const slotTag = slot
                ? `<span class="tag predict">✅ 확인 시 → ${escapeHtml(fmtKstDateTime(slot))} 예약</span>`
                : `<span class="tag draft">초안 · 미확인</span>`;
              const slotArg = slot ? escapeHtml(fmtKstDateTime(slot)).replace(/'/g, "\\'") : "예약 시간 미정";
              return editableCard(
                p,
                slotTag,
                `<button class="pub-btn approve" onclick="approveDraft('${escapeHtml(p.id)}', this, '${slotArg}')">✅ 확인 (예약)</button>
            <button class="pub-btn" onclick="publishNow('${escapeHtml(p.id)}', this)">🚀 즉시 게시</button>`
              );
            })
            .join("")}
        </details>`
        )
        .join("")
    : `<p class="empty">검토 대기 중인 초안이 없습니다.</p>`;

  const pendingHtml = pendingGroups.length
    ? pendingGroups
        .map(
          (g, gi) => `
        <details class="daygroup" ${gi === 0 ? "open" : ""}>
          <summary class="daylabel">${escapeHtml(g.label)} <span class="cnt">${g.items.length}건</span></summary>
          ${g.items
            .map((it) =>
              editableCard(
                it.post,
                `<span class="tag${it.isNext ? " next" : ""}">${it.time}${it.isNext ? " · 다음 순서" : ""}</span>`,
                `<button class="pub-btn" onclick="publishNow('${escapeHtml(it.post.id)}', this)">지금 발행</button>`
              )
            )
            .join("")}
        </details>`
        )
        .join("")
    : `<p class="empty">대기 중인 글이 없습니다.</p>`;

  const recentHtml = recent.length
    ? recent
        .map((p) => {
          const statusLabel = p.status === "published" ? "발행완료" : "발행실패";
          const dateStr = p.published_at
            ? new Date(p.published_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
            : new Date(p.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
          const link = p.thread_post_id
            ? `<a href="https://www.threads.com/@business.lab2026/post/${escapeHtml(p.thread_post_id)}" target="_blank">쓰레드에서 보기 →</a>`
            : "";
          const reasonHtml =
            p.status === "failed" && p.fail_reason
              ? `<div class="failreason">⚠ ${escapeHtml(p.fail_reason)}</div>`
              : "";
          const retryBtn =
            p.status === "failed"
              ? `<button class="pub-btn" onclick="publishNow('${escapeHtml(p.id)}', this)">재시도</button>`
              : "";
          return `
        <div class="card ${p.status}">
          <div class="row1"><div class="tag ${p.status}">${statusLabel}</div>${retryBtn}</div>
          <div class="content">${escapeHtml(p.content).replace(/\n/g, "<br>")}</div>
          ${reasonHtml}
          <div class="meta">${dateStr} ${link}</div>
        </div>`;
        })
        .join("")
    : `<p class="empty">기록이 없습니다.</p>`;

  const researchGroups = groupByDate(research, (r) => fmtKstDate(new Date(r.created_at)));
  const researchHtml = researchGroups.length
    ? researchGroups
        .map(
          (g, gi) => `
        <details class="daygroup research" ${gi === 0 ? "open" : ""}>
          <summary class="daylabel">${escapeHtml(g.label)} <span class="cnt">${g.items.length}건</span></summary>
          ${g.items
            .map(
              (r) => `
          <div class="card notecard">
            <div class="content note">${escapeHtml(r.summary).replace(/\n/g, "<br>")}</div>
            <div class="meta">${new Date(r.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</div>
          </div>`
            )
            .join("")}
        </details>`
        )
        .join("")
    : `<p class="empty">아직 정리된 리서치 노트가 없습니다.</p>`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>쓰레드 콘텐츠 관리</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif;background:#f3f5fb;color:#191d27;margin:0;padding:24px 16px 60px;}
  .wrap{max-width:640px;margin:0 auto;}
  .cols{display:flex;flex-direction:column;gap:0;}
  @media (min-width: 980px){
    .wrap{max-width:1180px;}
    .cols{flex-direction:row;align-items:flex-start;gap:28px;}
    .col-main{flex:1 1 640px;min-width:0;}
    .col-side{flex:0 0 380px;position:sticky;top:24px;}
  }
  h1{font-size:20px;margin:0 0 4px;}
  .sub{color:#5b6070;font-size:13px;margin:0 0 24px;}
  .sub a{color:#2e6bff;}
  h2{font-size:15px;margin:28px 0 10px;color:#2e6bff;}
  h2.side-title{margin-top:0;}
  .daygroup{margin-bottom:10px;background:transparent;}
  .daylabel{font-size:13px;font-weight:800;color:#191d27;margin:0 0 8px;padding:8px 2px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;}
  .daylabel::-webkit-details-marker{display:none;}
  .daylabel::before{content:"▸";color:#9298a8;font-size:11px;transition:transform .15s;}
  details[open] > .daylabel::before{transform:rotate(90deg);}
  .daylabel .cnt{color:#9298a8;font-weight:600;font-size:11.5px;}
  .card{background:#fff;border:1px solid #e3e6ef;border-radius:12px;padding:14px 16px;margin-bottom:10px;}
  .card.draft{border-color:#f0d78a;background:#fffdf6;}
  .card.notecard{border-color:#dfe6f5;background:#f8faff;}
  .row1{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap;}
  .btns{display:flex;gap:6px;flex-wrap:wrap;}
  .tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#e9f0ff;color:#2e6bff;}
  .tag.next{background:#fdf2dc;color:#7a5200;}
  .tag.published{background:#e6f6ea;color:#1a7a3c;}
  .tag.failed{background:#fdeceb;color:#c0392b;}
  .tag.draft{background:#fdf2dc;color:#8a6d00;}
  .tag.predict{background:#e6f6ea;color:#1a7a3c;}
  .content{font-size:14px;line-height:1.6;white-space:pre-wrap;}
  .content.note{font-size:13px;color:#3a4258;}
  .edit-area{width:100%;box-sizing:border-box;font-size:14px;line-height:1.6;font-family:inherit;border:1px solid #dde1e8;border-radius:8px;padding:10px;min-height:110px;resize:vertical;}
  .edit-btns{display:flex;gap:6px;margin-top:8px;}
  .failreason{font-size:12px;color:#c0392b;margin-top:8px;background:#fdeceb;border-radius:8px;padding:6px 10px;}
  .meta{font-size:11.5px;color:#9298a8;margin-top:8px;}
  .meta a{color:#2e6bff;text-decoration:none;}
  .empty{color:#9298a8;font-size:13px;}
  .pub-btn{background:#0c1220;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;}
  .pub-btn:disabled{opacity:.5;cursor:default;}
  .pub-btn.ok{background:#1a7a3c;}
  .pub-btn.err{background:#c0392b;}
  .pub-btn.approve{background:#2e6bff;}
  .pub-btn.edit{background:#fff;color:#4e5872;border:1px solid #dde1e8;}
  .pub-btn.save{background:#1a7a3c;}
  .pub-btn.cancel{background:#fff;color:#4e5872;border:1px solid #dde1e8;}
</style></head>
<body><div class="wrap">
  <h1>정책자금 쓰레드 콘텐츠 관리</h1>
  <p class="sub"><a href="/stats.html?key=${key}">← 방문자 통계로</a> · 실제 발행된 글은 <a href="https://www.threads.com/@business.lab2026" target="_blank">@business.lab2026</a>에서도 확인 가능 · 시간은 예상 발행 슬롯이며 큐 순서가 바뀌면 밀릴 수 있음</p>
  <div class="cols">
    <div class="col-main">
      <h2>초안 검토 (${drafts.length}건)</h2>
      ${draftsHtml}
      <h2>대기 중인 큐 (${pending.length}건, 날짜순)</h2>
      ${pendingHtml}
      <h2>최근 발행/실패 기록</h2>
      ${recentHtml}
    </div>
    <div class="col-side">
      <h2 class="side-title">📚 학습 노트 (리서치 요약)</h2>
      ${researchHtml}
    </div>
  </div>
</div>
<script>
async function callAction(url, btn, okText, doneClass) {
  btn.disabled = true;
  btn.textContent = '처리 중...';
  try {
    const r = await fetch(url, { method: 'POST' });
    const data = await r.json();
    if (r.ok && data.ok) {
      btn.textContent = okText;
      btn.classList.add(doneClass);
      setTimeout(() => location.reload(), 1100);
    } else {
      btn.textContent = '실패 (재시도)';
      btn.classList.add('err');
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = '오류 (재시도)';
    btn.classList.add('err');
    btn.disabled = false;
  }
}
function publishNow(id, btn) {
  if (!confirm('지금 바로 쓰레드에 발행할까요?')) return;
  callAction('/api/thread-publish-one?id=' + encodeURIComponent(id) + '&key=${key}', btn, '발행 완료', 'ok');
}
function approveDraft(id, btn, whenText) {
  if (!confirm('이 초안을 확인 처리할까요?\\n\\n예상 발행 시각: ' + whenText)) return;
  callAction('/api/thread-approve?id=' + encodeURIComponent(id) + '&key=${key}', btn, '예약 완료 (' + whenText + ')', 'ok');
}
function toggleEdit(id) {
  const content = document.getElementById('content-' + id);
  const area = document.getElementById('edit-' + id);
  const btns = document.getElementById('editbtns-' + id);
  const editing = area.style.display !== 'none';
  content.style.display = editing ? '' : 'none';
  area.style.display = editing ? 'none' : '';
  btns.style.display = editing ? 'none' : 'flex';
  if (!editing) area.focus();
}
async function saveEdit(id, btn) {
  const area = document.getElementById('edit-' + id);
  const content = area.value.trim();
  if (!content) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '저장 중...';
  try {
    const r = await fetch('/api/thread-edit?id=' + encodeURIComponent(id) + '&key=${key}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await r.json();
    if (r.ok && data.ok) {
      location.reload();
    } else {
      btn.textContent = '실패 (재시도)';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = '오류 (재시도)';
    btn.disabled = false;
  }
}
</script>
</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const cronSecret = clean(process.env.CRON_SECRET);
  const queryKey = clean(req.query.key);
  if (cronSecret) {
    const authHeader = req.headers.authorization || "";
    const authorized = authHeader === `Bearer ${cronSecret}` || queryKey === cronSecret;
    if (!authorized) {
      res.status(401).send("unauthorized");
      return;
    }
  }

  const supabaseUrl = clean(process.env.SUPABASE_URL);
  const anonKey = clean(process.env.SUPABASE_ANON_KEY);
  const authHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  try {
    const [draftsRes, pendingRes, recentRes, researchRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/thread_posts?status=eq.draft&order=created_at.asc&select=id,content,status,created_at`,
        { headers: authHeaders }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/thread_posts?status=eq.pending&order=created_at.asc&select=id,content,status,created_at`,
        { headers: authHeaders }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/thread_posts?status=in.(published,failed)&order=created_at.desc&limit=10&select=id,content,status,created_at,published_at,thread_post_id,fail_reason`,
        { headers: authHeaders }
      ),
      fetch(`${supabaseUrl}/rest/v1/thread_research?order=created_at.desc&limit=10&select=id,summary,created_at`, {
        headers: authHeaders,
      }),
    ]);
    const drafts = await draftsRes.json();
    const pending = await pendingRes.json();
    let recent = await recentRes.json();
    let research = await researchRes.json();

    if (!recentRes.ok) {
      // fail_reason column may not exist yet — retry without it
      const fallbackRes = await fetch(
        `${supabaseUrl}/rest/v1/thread_posts?status=in.(published,failed)&order=created_at.desc&limit=10&select=id,content,status,created_at,published_at,thread_post_id`,
        { headers: authHeaders }
      );
      recent = await fallbackRes.json();
    }
    if (!researchRes.ok) {
      // thread_research table may not exist yet
      research = [];
    }
    if (!draftsRes.ok || !pendingRes.ok) {
      res.status(502).json({ error: "supabase error", drafts, pending });
      return;
    }

    if (req.query.format === "json") {
      res.status(200).json({ ok: true, drafts, pending, recent, research });
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderPage(drafts, pending, recent, research, queryKey));
  } catch (e) {
    res.status(500).json({ error: "server error", detail: String(e) });
  }
}
