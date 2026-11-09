import type { FastifyInstance } from 'fastify';

const showcase = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#192c25">
  <meta name="description" content="Monexis — dự án portfolio về AI agent tư vấn bánh qua Messenger.">
  <title>Monexis · Commerce AI Agent</title>
  <style>
    :root{color-scheme:light;--ink:#1c3027;--cream:#f7f1e5;--orange:#d46a3c;--line:#b9c0aa}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--cream);color:var(--ink);font-family:Georgia,serif}a{color:inherit}a:focus-visible{outline:3px solid var(--orange);outline-offset:5px}
    .wrap{max-width:1360px;margin:auto;padding:0 6%}.top{display:flex;align-items:center;justify-content:space-between;padding-top:30px;padding-bottom:30px;border-bottom:1px solid var(--line)}.brand{font-size:26px;letter-spacing:-.06em;font-weight:bold;text-decoration:none}.brand span{color:var(--orange)}.top small,.eyebrow,.tag,.number,.foot{font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em}.top small{font-size:10px}.top a.repo{font-family:ui-monospace,monospace;text-transform:uppercase;font-size:11px;text-decoration:none;letter-spacing:.1em}
    .hero{display:grid;grid-template-columns:1.05fr .95fr;min-height:620px;gap:5%;align-items:center;padding-top:55px;padding-bottom:70px}.eyebrow{font-size:11px;display:flex;align-items:center;gap:12px}.eyebrow:before{content:'';width:30px;height:1px;background:var(--orange)}h1{font-size:clamp(60px,7.8vw,112px);font-weight:normal;line-height:.91;letter-spacing:-.065em;margin:30px 0}h1 em{font-weight:normal;color:var(--orange)}.intro{font-size:19px;line-height:1.65;max-width:510px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.button{font-family:ui-monospace,monospace;letter-spacing:.04em;font-size:12px;text-decoration:none;padding:17px 22px;border:1px solid var(--ink);transition:transform .2s,background .2s}.button:hover{transform:translateY(-3px)}.button.primary{background:var(--ink);color:var(--cream)}.button.secondary:hover{background:#e7dfce}.note{font:12px/1.6 ui-monospace,monospace;max-width:470px;margin-top:25px}
    .visual{background:#d7deca;min-height:525px;position:relative;overflow:hidden;display:grid;place-items:center}.visual:before,.visual:after{content:'';position:absolute;border:1px solid rgba(28,48,39,.2);border-radius:50%;width:440px;height:440px}.visual:after{width:340px;height:340px}.visual .orb{position:relative;z-index:1;width:min(68%,330px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 32% 27%,#fbe9be 0,#dfab70 30%,#a64c2d 75%,#602f26 100%);box-shadow:inset -20px -25px 45px #6d372b80,0 35px 50px #3c4c3d50;display:grid;place-items:center;animation:rise 1s ease both}.orb span{font-size:clamp(88px,10vw,140px);transform:rotate(-15deg);filter:drop-shadow(0 14px 8px #78432977)}.visual .stamp{position:absolute;z-index:2;top:26px;left:26px;border:1px solid var(--ink);border-radius:50%;width:86px;height:86px;display:grid;place-items:center;text-align:center;font:10px/1.5 ui-monospace,monospace;transform:rotate(-13deg)}.visual .caption{position:absolute;z-index:2;bottom:24px;right:25px;text-align:right;font:10px/1.6 ui-monospace,monospace;letter-spacing:.1em}
    .band{background:var(--ink);color:var(--cream);padding:24px 0;font:11px/1.6 ui-monospace,monospace;letter-spacing:.09em}.band .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.details{padding-top:110px;padding-bottom:110px}.details-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:45px}.details h2{font-size:clamp(42px,5vw,68px);font-weight:normal;letter-spacing:-.05em;line-height:1;margin:14px 0 0}.details-head p{max-width:330px;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line)}.card{padding:28px 28px 0 0}.card+.card{border-left:1px solid var(--line);padding-left:28px}.number{font-size:11px;color:#a44d2f}.card h3{font-size:26px;font-weight:normal;margin:35px 0 15px}.card p{font-size:16px;line-height:1.7;max-width:330px}.disclaimer{background:#e8e0d0;padding:26px 30px;margin-top:65px;line-height:1.6;font-size:15px}.foot{border-top:1px solid var(--line);padding-top:28px;padding-bottom:35px;font-size:10px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}@media(max-width:760px){.top small{display:none}.hero{grid-template-columns:1fr;gap:45px;padding-top:65px}.visual{min-height:390px}.details{padding-top:75px;padding-bottom:75px}.details-head{display:block}.grid{grid-template-columns:1fr}.card+.card{border-left:0;border-top:1px solid var(--line);padding-left:0}.card{padding:25px 0}.card h3{margin:20px 0 10px}.band .wrap{display:block}.band span{display:block;margin:6px 0}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <header class="wrap top"><a class="brand" href="/">monexis<span>.</span></a><small>Portfolio project / 2026</small><a class="repo" href="https://github.com/23092003e/commerce-ai-agent">GitHub ↗</a></header>
  <main>
    <section class="wrap hero"><div><div class="eyebrow">A thoughtful commerce experience</div><h1>Bánh ngon.<br><em>Hội thoại</em><br>thông minh.</h1><p class="intro">Một AI agent cho cửa hàng bánh giả lập, kết nối Messenger với dữ liệu sản phẩm, tài liệu và công cụ hỗ trợ bán hàng.</p><div class="actions"><a class="button primary" href="https://github.com/23092003e/commerce-ai-agent">Khám phá mã nguồn ↗</a><a class="button secondary" href="#how-it-works">Cách hoạt động ↓</a></div><p class="note">PORTFOLIO DEMO · Dữ liệu mẫu · Không cần nhập thông tin cá nhân</p></div><div class="visual" aria-hidden="true"><div class="stamp">BAKED<br>WITH<br>DATA</div><div class="orb"><span>🥐</span></div><div class="caption">MONEXIS / 01<br>THE BAKERY EDITION</div></div></section>
    <div class="band"><div class="wrap"><span>01 / MESSENGER</span><span>02 / RETRIEVAL-AUGMENTED GENERATION</span><span>03 / HUMAN HANDOVER</span></div></div>
    <section class="wrap details" id="how-it-works"><div class="details-head"><div><div class="eyebrow">Behind the conversation</div><h2>Từ câu hỏi<br>đến hành động.</h2></div><p>Một lát cắt thực tế của hệ thống bán hàng: thông tin có căn cứ, công cụ có kiểm soát và con người luôn có quyền tiếp quản.</p></div><div class="grid"><article class="card"><div class="number">01 / CATALOG</div><h3>Dữ liệu sản phẩm</h3><p>Tra cứu sản phẩm, giá và tồn kho từ cơ sở dữ liệu thay vì tự suy đoán.</p></article><article class="card"><div class="number">02 / KNOWLEDGE</div><h3>Truy xuất tài liệu</h3><p>RAG tìm nội dung liên quan trong tài liệu mẫu để hỗ trợ trả lời câu hỏi về cửa hàng.</p></article><article class="card"><div class="number">03 / CONTROL</div><h3>Con người tiếp quản</h3><p>Khi thiếu căn cứ hoặc gặp lỗi, hội thoại có thể chuyển sang nhân viên để xử lý an toàn.</p></article></div><div class="disclaimer"><strong>Về bản trình diễn.</strong> Monexis là cửa hàng giả lập: đơn hàng không giao hàng và không thanh toán thật. Messenger hiện có thể chỉ hoạt động với tài khoản được cấp quyền thử nghiệm; hệ thống miễn phí và nhà cung cấp AI đôi lúc phản hồi chậm hoặc không khả dụng.</div></section>
  </main><footer class="wrap foot"><span>MONEXIS / COMMERCE AI AGENT</span><span>BUILT FOR LEARNING &amp; EXPLORATION</span></footer>
</body></html>`;

export function registerShowcase(app: FastifyInstance): void {
  app.get('/', async (_request, reply) =>
    reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'strict-origin-when-cross-origin')
      .header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(showcase)
  );
}
