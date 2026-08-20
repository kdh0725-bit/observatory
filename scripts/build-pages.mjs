#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   상품별 정적 페이지 생성기

   왜 정적인가 — 홈은 JS 로 690개를 그리지만, 크롤러가 처음 받는 HTML 에는
   상품이 하나도 없다. 검색에 걸리려면 가격·이력이 HTML 안에 박혀 있어야 한다.

   왜 사라진 상품도 남기는가 — 특가 목록에서 빠져도 우리 기록은 남는다.
   그 상품이 다시 특가로 나왔을 때 "예전에 얼마였지"를 검색하는 사람이 있다.
   지금 사이트에선 사라진 상품이 아예 안 보이지만, 페이지는 계속 일한다.

   ★ 규칙은 앱·카드툴과 같다: 재등장 우선 판정 · 표본 크기 명시 ·
     할인율 버림 · 날짜 비례 x축 · 결손 점선 · themes 미사용.

   실행: node scripts/build-pages.mjs [데이터경로]
   ════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://pricelog.tulbo.tools';
const OUT = 'p';
const ARCHIVE = 'data/archive.json';   /* 사라진 상품 기록 누적 */

/* ── 보존 기간 ────────────────────────────────────────────
   ★ 레포가 무한히 커지는 걸 막는다.
     매일 700개 페이지가 바뀌면 git 히스토리에 하루 5MB씩 쌓이고,
     1년이면 2GB다. GitHub 권장치(1GB)를 넘으면 경고가 오고 clone 도 느려진다.
   ★ 90일 — 특가는 계절을 타서 3개월이면 대개 다시 등장한다.
     그 안에 한 번도 안 나온 상품은 검색 가치도 거의 없다.
   ★ 기록 자체를 버리는 게 아니라 '페이지'만 접는다.
     원본은 데이터 저장소에 그대로 있고, 다시 특가에 오르면 페이지도 되살아난다. */
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 90);
const SRC = process.argv[2] || process.env.FEED_PATH ||
  'https://raw.githubusercontent.com/kdh0725-bit/deal-salkka-data/main/data/deals-latest.json';

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const won = n => Number(n).toLocaleString('ko-KR');
const md  = s => s.slice(5).replace('-','/');
const dayGap = (a,b) => Math.round((new Date(b)-new Date(a))/864e5);
const H = i => i.priceHistory || [];

/* ── 앱과 같은 규칙 ── */
const disc = i => i.original && i.original > i.price
  ? Math.floor((1 - i.price/i.original) * 100) : null;   /* ★ 버림 */

function segsOf(h){
  const s=[[0]];
  for(let k=1;k<h.length;k++){
    if(dayGap(h[k-1].date,h[k].date)>1) s.push([k]); else s[s.length-1].push(k);
  }
  return s;
}

function rankOf(i){
  const h=H(i); if(h.length<2) return {k:'first',t:'첫 관측',d:'오늘 처음 기록했습니다. 비교할 이전 값이 아직 없습니다.'};
  const t=h[h.length-1].price, past=h.slice(0,-1).map(x=>x.price);
  const mn=Math.min(...past), mx=Math.max(...past);
  const sg=segsOf(h);
  /* ★ 재등장을 최저/최고보다 먼저 가른다 — 그 사이 값은 우리가 모른다 */
  if(sg.length>=2 && sg[sg.length-1][0]===h.length-1){
    const b=h[sg[sg.length-2][sg[sg.length-2].length-1]], a=h[h.length-1];
    const away=dayGap(b.date,a.date)-1;
    if(a.price<b.price) return {k:'back_down',t:`${away}일 만에 다시 등장 · 더 쌈`,
      d:`빠지기 전 ${md(b.date)}에는 ${won(b.price)}원이었습니다. ${away}일간 특가 목록에 없다가 ${won(b.price-a.price)}원 낮은 값으로 다시 나타났습니다. 그 사이 값은 관측하지 못했습니다.`};
    if(a.price>b.price) return {k:'back_up',t:`${away}일 만에 다시 등장 · 더 비쌈`,
      d:`빠지기 전 ${md(b.date)}에는 ${won(b.price)}원이었습니다. 그때가 더 쌌습니다.`};
    return {k:'back_same',t:`${away}일 만에 같은 값으로 다시 등장`,
      d:`${away}일간 특가 목록에 없다가 같은 값으로 다시 나타났습니다.`};
  }
  if(t<mn) return {k:'low',t:`${h.length}회 관측 중 최저`,
    d:`적어둔 ${h.length}번 중 오늘이 가장 낮습니다. 직전 최저는 ${won(mn)}원이었습니다.`};
  if(t>mx) return {k:'high',t:`${h.length}회 관측 중 최고`,
    d:`적어둔 ${h.length}번 중 오늘이 가장 높습니다. 직전 최고는 ${won(mx)}원이었습니다.`};
  if(t===mn&&mn!==mx) return {k:'tie',t:`${h.length}회 관측 최저와 동일 · 신저가 아님`,
    d:`${won(mx)}원까지 올랐다가 원래 값으로 돌아온 것입니다. 새로 싸진 것은 아닙니다.`};
  if(mn===mx) return {k:'flat',t:'변동 없음',
    d:`${h.length}번 적어두는 동안 값이 한 번도 움직이지 않았습니다.`};
  return {k:'mid',t:'관측 범위 안',
    d:`${h.length}번 적어둔 범위는 ${won(mn)}~${won(mx)}원입니다.`};
}

/* ── 그래프 (홈·카드와 같은 규칙) ── */
function chart(h, w=680, ht=200){
  const p=h.map(x=>x.price);
  if(p.length<2) return '';
  const lo=Math.min(...p), hi=Math.max(...p);
  const pad=Math.max((hi-lo)*.3, hi*.02), ymin=lo-pad, ymax=hi+pad;
  const span=Math.max(1, dayGap(h[0].date, h[h.length-1].date));
  const X=k=>24+(w-48)*(dayGap(h[0].date,h[k].date)/span);
  const Y=v=>24+(ht-64)*(ymax-v)/((ymax-ymin)||1);
  const sg=segsOf(h);
  const solid=sg.filter(g=>g.length>1).map(g=>
    `<polyline points="${g.map(k=>`${X(k).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="#1B2A4A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const gaps=sg.slice(1).map((g,n)=>{
    const a=sg[n][sg[n].length-1], b=g[0];
    return `<line x1="${X(a).toFixed(1)}" y1="${Y(p[a]).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(p[b]).toFixed(1)}" stroke="#1B2A4A" stroke-opacity=".3" stroke-width="2.5" stroke-dasharray="6 7" stroke-linecap="round"/>`;
  }).join('');
  const dots=p.slice(0,-1).map((v,k)=>`<circle cx="${X(k).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="#1B2A4A"/>`).join('');
  const li=p.length-1;
  return `<svg viewBox="0 0 ${w} ${ht}" width="100%" role="img" aria-label="가격 관측 그래프">
  <line x1="24" y1="${Y(hi).toFixed(1)}" x2="${w-24}" y2="${Y(hi).toFixed(1)}" stroke="#E8E3D9" stroke-dasharray="5 5"/>
  <line x1="24" y1="${Y(lo).toFixed(1)}" x2="${w-24}" y2="${Y(lo).toFixed(1)}" stroke="#E8E3D9" stroke-dasharray="5 5"/>
  <text x="26" y="${(Y(hi)-8).toFixed(1)}" font-size="12" fill="#A8AFBD">최고 ${won(hi)}원</text>
  <text x="26" y="${(Y(lo)+18).toFixed(1)}" font-size="12" fill="#A8AFBD">최저 ${won(lo)}원</text>
  ${solid}${gaps}<g>${dots}</g>
  <circle cx="${X(li).toFixed(1)}" cy="${Y(p[li]).toFixed(1)}" r="6" fill="#D94F35"/>
  <text x="24" y="${ht-8}" font-size="12" fill="#A8AFBD">${md(h[0].date)}</text>
  <text x="${w-24}" y="${ht-8}" font-size="12" fill="#A8AFBD" text-anchor="end">${md(h[h.length-1].date)}</text>
</svg>`;
}

function page(it, live){
  const h=H(it), r=rankOf(it), d=disc(it), u=it.unitPrice;
  const sg=segsOf(h);
  const missDays=sg.slice(1).reduce((n,g,k)=>n+dayGap(h[sg[k][sg[k].length-1]].date,h[g[0]].date)-1,0);
  const rows=[...h].reverse().map(x=>
    `<tr><td>${x.date}</td><td class="num">${won(x.price)}원</td></tr>`).join('');
  const title=`${it.name} 가격 기록 — 가격관측소`;
  const desc=`${it.name} 최근 ${h.length}회 관측 기록. 오늘 ${won(it.price)}원. ${r.t}. ${
    h.length>1?`관측 범위 ${won(Math.min(...h.map(x=>x.price)))}~${won(Math.max(...h.map(x=>x.price)))}원.`:''}`;
  /* ★ 구조화 데이터 — 가격은 우리가 관측한 값이고, 판매처는 토스쇼핑이다.
       사라진 상품은 재고 없음으로 명시한다(있지도 않은 걸 판다고 하지 않는다). */
  const ld={"@context":"https://schema.org","@type":"Product","name":it.name,
    ...(it.thumb?{image:it.thumb}:{}),
    ...(it.categoryName?{category:it.categoryName}:{}),
    offers:{"@type":"Offer",priceCurrency:"KRW",price:String(it.price),
      availability:live?"https://schema.org/InStock":"https://schema.org/OutOfStock",
      url:it.link||SITE},
    ...(it.score?{aggregateRating:{"@type":"AggregateRating",ratingValue:String(it.score),
      reviewCount:String(it.reviews||0)}}:{})};

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/${OUT}/${it.id}.html">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="article">
<meta property="og:site_name" content="가격관측소">
<meta property="og:url" content="${SITE}/${OUT}/${it.id}.html">
<meta property="og:title" content="${esc(it.name)} — ${esc(r.t)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(it.thumb||SITE+'/og.png')}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;
     background:#FAF8F3;color:#1B2A4A;-webkit-font-smoothing:antialiased;line-height:1.6}
.wrap{max-width:720px;margin:0 auto;padding:0 20px 72px}
header{padding:26px 0 18px;border-bottom:1px solid #E2DDD3}
.brand{font-size:13px;color:#A8AFBD}
.brand a{color:#A8AFBD;text-decoration:none}
h1{font-size:23px;font-weight:800;margin-top:26px;letter-spacing:-.4px}
.meta{margin-top:8px;font-size:13px;color:#8A93A5}
.price{margin-top:18px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.p{font-size:38px;font-weight:800;letter-spacing:-1px}
.off{font-size:17px;font-weight:700;color:#D94F35}
.was{font-size:15px;color:#A8AFBD;text-decoration:line-through}
.wasn{font-size:12px;color:#B4BAC6}
.unit{margin-top:4px;font-size:14px;color:#D94F35;font-weight:700}
.badge{display:inline-block;margin-top:14px;font-size:13px;font-weight:700;
  padding:6px 13px;border-radius:99px;background:#FDEDE9;color:#D94F35}
.badge.flat,.badge.mid{background:#EFEBE2;color:#5A6478}
.verdict{margin-top:12px;font-size:15px;color:#5A6478}
section{margin-top:34px}
h2{font-size:16px;font-weight:800;padding-bottom:9px;border-bottom:2px solid #1B2A4A}
.chart{margin-top:14px;background:#fff;border:1px solid #E2DDD3;border-radius:12px;padding:8px}
.legend{margin-top:8px;font-size:12.5px;color:#8A93A5}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;background:#fff}
th,td{padding:10px 12px;border-bottom:1px solid #EFEBE2;text-align:left}
th{font-size:12.5px;color:#8A93A5;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.cta{display:block;margin-top:20px;padding:15px;text-align:center;border-radius:12px;
  background:#3182F6;color:#fff;font-weight:700;text-decoration:none;font-size:15px}
.cta.off2{background:#EFEBE2;color:#8A93A5;pointer-events:none}
.back{display:inline-block;margin-top:26px;font-size:14px;color:#3182F6;text-decoration:none}
footer{margin-top:40px;padding-top:18px;border-top:1px solid #E2DDD3;font-size:12px;
  color:#A8AFBD;line-height:1.75}
</style></head><body><div class="wrap">
<header><div class="brand"><a href="${SITE}/">가격관측소</a> · @price.observatory</div></header>

<h1>${esc(it.name)}</h1>
<div class="meta">${it.categoryName?esc(it.categoryName)+' · ':''}${
  it.score?`별점 ${it.score} · 후기 ${won(it.reviews||0)}개 · `:''}${h.length}회 관측${
  missDays?` · ${missDays}일 관측 없음`:''}</div>

<div class="price">
  <span class="p">${won(it.price)}원</span>
  ${d!=null&&d>=1?`<span class="off">${d}%</span>`:''}
  ${it.original&&it.original>it.price?`<span class="was">${won(it.original)}원</span><span class="wasn">판매자 표기</span>`:''}
</div>
${u&&u.count>=2&&u.perUnit?`<div class="unit">총 ${u.count}개 · 개당 ${won(u.perUnit)}원</div>`:''}
<div class="badge ${r.k}">${esc(r.t)}</div>
<p class="verdict">${esc(r.d)}</p>

${live&&it.link?`<a class="cta" href="${esc(it.link)}" rel="nofollow sponsored">토스쇼핑에서 보기</a>`
  :`<span class="cta off2">지금은 특가 목록에 없습니다</span>`}

<section><h2>가격 관측 기록</h2>
<div class="chart">${chart(h)}</div>
${missDays?`<div class="legend">점선 구간은 특가 목록에 없어 관측하지 못한 날입니다.</div>`:''}
<table><thead><tr><th>날짜</th><th class="num">관측 가격</th></tr></thead>
<tbody>${rows}</tbody></table>
</section>

<a class="back" href="${SITE}/">← 전체 관측 기록 보기</a>

<footer>
가격은 토스쇼핑 화면 표기를 매일 수집한 것입니다. 수집 시점 기준이라 실제 판매가와 다를 수 있습니다.<br>
목록에 없는 날은 관측되지 않으며, 그 구간의 값은 알 수 없습니다.<br>
정가는 판매자가 적은 값이라 회사가 검증한 값이 아닙니다.<br>
이 페이지의 링크는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.
</footer>
</div></body></html>`;
}

/* ── 실행 ── */
const raw = /^https?:/.test(SRC)
  ? await (await fetch(SRC)).json()
  : JSON.parse(fs.readFileSync(SRC,'utf8'));

/* 아카이브 병합 — 오늘 목록에서 빠진 상품도 페이지를 유지한다 */
let archive = {};
try { archive = JSON.parse(fs.readFileSync(ARCHIVE,'utf8')); } catch {}
const liveIds = new Set(raw.items.map(i=>i.id));
raw.items.forEach(i=>{ archive[i.id] = i; });          /* 최신으로 갱신 */

fs.mkdirSync(OUT,{recursive:true});
fs.mkdirSync(path.dirname(ARCHIVE),{recursive:true});

/* ── 오래된 상품 정리 ────────────────────────────────────
   마지막 관측일이 RETENTION_DAYS 를 넘긴 상품은 아카이브·페이지에서 뺀다.
   오늘 목록에 있는 상품은 날짜와 무관하게 남긴다(데이터가 밀렸을 수 있다). */
const today = new Date().toISOString().slice(0,10);
let retired = 0;
for (const [id, it] of Object.entries(archive)) {
  if (liveIds.has(it.id)) continue;
  const last = (H(it).slice(-1)[0]||{}).date;
  if (!last || dayGap(last, today) > RETENTION_DAYS) {
    delete archive[id];
    retired++;
  }
}

const urls = [];
let made = 0, skipped = 0, unchanged = 0;
const keep = new Set();
for (const [id, it] of Object.entries(archive)) {
  /* ★ 이력 1회짜리는 만들지 않는다 — 검색에 걸려도 보여줄 게 없다(얇은 페이지) */
  if (H(it).length < 2) { skipped++; continue; }
  const file = path.join(OUT, `${id}.html`);
  const html = page(it, liveIds.has(it.id));
  keep.add(`${id}.html`);
  /* ★ 내용이 같으면 다시 쓰지 않는다.
       매번 덮어쓰면 git 이 변경으로 보지는 않지만, 불필요한 디스크 I/O 와
       Actions 시간이 늘고 실수로 mtime 기반 도구가 오작동한다. */
  let prev = null;
  try { prev = fs.readFileSync(file,'utf8'); } catch {}
  if (prev === html) { unchanged++; }
  else fs.writeFileSync(file, html);
  urls.push({loc:`${SITE}/${OUT}/${id}.html`, lastmod:(H(it).slice(-1)[0]||{}).date});
  made++;
}

/* 아카이브에서 빠진 상품의 페이지 파일을 지운다(고아 파일 정리).
   ★ 지우지 않으면 사이트맵엔 없는데 파일만 남아 404 대신 유령 페이지가 뜬다. */
let removed = 0;
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.html') && !keep.has(f)) { fs.unlinkSync(path.join(OUT,f)); removed++; }
}

fs.writeFileSync(ARCHIVE, JSON.stringify(archive));

fs.writeFileSync('sitemap.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
${urls.map(u=>`  <url><loc>${u.loc}</loc><lastmod>${u.lastmod||today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`).join('\n')}
</urlset>`);

/* 용량 감시 — 조용히 커지다가 어느 날 경고 메일을 받는 걸 막는다 */
const bytes = fs.readdirSync(OUT).reduce((n,f)=>n+fs.statSync(path.join(OUT,f)).size,0);
const mb = (bytes/1048576).toFixed(1);

console.log(`상품 페이지 ${made}개 (내용 그대로 ${unchanged}개 · 이력 1회라 건너뜀 ${skipped}개)`);
console.log(`아카이브 ${Object.keys(archive).length}개 · 오늘 목록 ${liveIds.size}개`);
console.log(`정리: ${RETENTION_DAYS}일 초과 ${retired}개 · 고아 파일 ${removed}개 삭제`);
console.log(`사이트맵 ${urls.length+1}개 URL · 페이지 용량 ${mb}MB`);
if (bytes > 200*1048576)
  console.log('⚠ 페이지 용량이 200MB를 넘었습니다 — RETENTION_DAYS 를 줄이는 것을 검토하세요');
