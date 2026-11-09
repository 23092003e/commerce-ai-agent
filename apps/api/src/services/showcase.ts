import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

const showcase = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1b100e">
  <meta name="description" content="Monexis — dự án AI agent tư vấn bán hàng qua Messenger, kết hợp RAG và dữ liệu sản phẩm.">
  <title>Monexis — AI Sales Agent</title>
  <style>
    :root { color-scheme: dark; --bg: #1b100e; --cream: #f9efe1; --muted: #ddc9bb; --accent: #ffb473; --line: rgba(255,231,207,.19); }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--cream); font-family: 'Segoe UI', 'Noto Sans', 'Liberation Sans', sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: inherit; }
    a:focus-visible { outline: 3px solid #ffbd7c; outline-offset: 5px; }
    .shell { width: min(1380px, calc(100% - 96px)); margin-inline: auto; }
    .top { height: 94px; display: flex; align-items: center; justify-content: space-between; gap: 30px; border-bottom: 1px solid var(--line); }
    .brand { text-decoration: none; font-weight: 750; font-size: 25px; display: inline-flex; align-items: center; gap: 11px; }
    .mark { width: 31px; height: 31px; display: grid; place-items: center; border: 1px solid #f4b077; border-radius: 50%; color: #f4b077; font-family: Georgia, serif; font-style: italic; font-weight: 400; }
    .brand span:last-child { color: var(--accent); }
    .nav { display: flex; align-items: center; gap: 35px; font-size: 13px; color: #ead9cd; }
    .nav a { text-decoration: none; transition: color .2s ease; }
    .nav a:hover { color: #ffbd83; }
    .nav .nav-button { border: 1px solid #806451; border-radius: 999px; padding: 12px 18px; }
    .hero { position: relative; display: grid; grid-template-columns: 1.04fr .96fr; min-height: 700px; align-items: center; gap: 5%; padding-block: 74px 82px; }
    .copy { position: relative; z-index: 2; max-width: 650px; animation: enter .8s ease both; }
    .eyebrow { display: flex; align-items: center; gap: 11px; font-size: 11px; font-weight: 700; letter-spacing: .17em; color: #f1b38b; text-transform: uppercase; }
    .eyebrow::before { content: ''; width: 27px; height: 1px; background: #e29b70; }
    h1 { font-size: clamp(58px, 6.4vw, 98px); line-height: 1.12; font-weight: 650; letter-spacing: -.025em; margin: 30px 0 24px; }
    h1 .accent { color: var(--accent); display: block; }
    .lead { max-width: 520px; font-size: clamp(16px, 1.35vw, 19px); line-height: 1.75; color: var(--muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
    .button { min-height: 52px; display: inline-flex; justify-content: center; align-items: center; gap: 18px; padding: 0 22px; border: 1px solid #ac8971; border-radius: 5px; text-decoration: none; font-size: 14px; font-weight: 650; transition: background .2s, color .2s, border-color .2s; }
    .button.primary { color: #22120c; background: #ffc18d; border-color: #ffc18d; }
    .button.primary:hover { background: #ffdbba; border-color: #ffdbba; }
    .button.secondary:hover { background: #39231d; border-color: #ffc18d; }
    .micro { color: #cdb5a5; font-size: 12px; line-height: 1.65; margin-top: 25px; }
    .hero-art { position: relative; min-height: 620px; perspective: 1200px; }
    .art-frame { position: absolute; inset: 0 0 0 4%; overflow: hidden; border: 1px solid rgba(255,214,179,.22); border-radius: 220px 220px 12px 12px; background: #32170f; box-shadow: 0 35px 80px #0006; transform: rotate(2deg); animation: float 7s ease-in-out infinite; }
    .art-frame img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .art-frame::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 65%, rgba(28,12,8,.6)); pointer-events: none; }
    .art-index { position: absolute; bottom: 25px; right: 25px; z-index: 1; color: #ffe2c6; font-size: 10px; letter-spacing: .15em; line-height: 1.7; text-align: right; }
    .art-card { position: absolute; left: -7%; bottom: 70px; width: min(250px, 68%); padding: 18px 19px; border: 1px solid rgba(255,226,201,.3); border-radius: 12px; background: rgba(49,27,21,.92); box-shadow: 0 22px 50px #0008; transform: rotate(-5deg); }
    .art-card-top { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 700; color: #ffc498; }
    .spark { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: #a95c37; color: white; font-size: 16px; }
    .art-card p { font-size: 13px; line-height: 1.55; margin: 12px 0 0; color: #fff4e9; }
    .art-card small { display: block; font-size: 10px; margin-top: 12px; color: #d6b5a0; }
    .strip { border-block: 1px solid var(--line); padding-block: 20px; color: #e5cdbb; font-size: 10px; font-weight: 700; letter-spacing: .15em; }
    .strip .shell { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
    .strip b { color: #d98d60; margin-right: 9px; }
    .section { padding-block: 125px; }
    .section-head { display: grid; grid-template-columns: 1fr .65fr; align-items: end; gap: 50px; margin-bottom: 56px; }
    .section h2 { font-size: clamp(38px, 4.3vw, 64px); line-height: 1.16; letter-spacing: -.02em; font-weight: 620; margin: 22px 0 0; }
    .section-head > p { max-width: 410px; color: var(--muted); font-size: 16px; line-height: 1.8; margin: 0; }
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .feature { position: relative; min-height: 270px; padding: 29px; border: 1px solid #65483a; border-radius: 10px; background: linear-gradient(155deg,#38241e,#241713 70%); }
    .feature-number { display: flex; justify-content: space-between; color: #e2a278; font-size: 11px; font-weight: 700; letter-spacing: .13em; }
    .feature-icon { width: 42px; height: 42px; border: 1px solid #9b6d51; border-radius: 50%; display: grid; place-items: center; font-size: 19px; color: #ffbd86; }
    .feature h3 { margin: 58px 0 12px; font-size: 21px; font-weight: 650; }
    .feature p { max-width: 310px; margin: 0; color: #ddc9bb; font-size: 14px; line-height: 1.7; }
    .flow { background: #f7eadb; color: #281915; }
    .flow .eyebrow { color: #995533; }
    .flow-head { display: flex; align-items: end; justify-content: space-between; gap: 25px; margin-bottom: 55px; }
    .flow h2 { margin-top: 20px; }
    .flow-head p { color: #5d4940; max-width: 365px; font-size: 15px; line-height: 1.75; }
    .steps { display: grid; grid-template-columns: repeat(4,1fr); border-top: 1px solid #bca99a; }
    .step { padding: 25px 22px 0 0; }
    .step + .step { border-left: 1px solid #bca99a; padding-left: 24px; }
    .step span { color: #a34e29; font-size: 11px; font-weight: 750; letter-spacing: .12em; }
    .step h3 { font-size: 18px; margin: 35px 0 10px; }
    .step p { color: #604b40; font-size: 14px; line-height: 1.7; }
    .closing { display: grid; grid-template-columns: 1fr auto; gap: 40px; align-items: center; padding-block: 95px; }
    .closing h2 { margin: 16px 0; font-size: clamp(35px, 4vw, 56px); line-height: 1.2; }
    .closing p { max-width: 650px; color: var(--muted); line-height: 1.75; }
    .notice { border-left: 2px solid #e39b6a; padding-left: 17px; font-size: 13px; }
    footer { border-top: 1px solid var(--line); padding: 25px 0; color: #d0b7a4; font-size: 11px; }
    footer .shell { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    @keyframes enter { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes float { 0%,100% { transform: rotate(2deg) translateY(0); } 50% { transform: rotate(1deg) translateY(-10px); } }
    @media (max-width: 900px) { .shell { width: min(100% - 48px, 720px); } .nav a:not(.nav-button) { display: none; } .hero { grid-template-columns: 1fr; gap: 50px; padding-top: 65px; } .hero-art { min-height: 650px; max-width: 560px; width: 100%; margin-inline: auto; } .art-card { left: 0; } .section-head { grid-template-columns: 1fr; gap: 20px; } .features { grid-template-columns: 1fr; } .feature { min-height: 210px; } .feature h3 { margin-top: 35px; } .steps { grid-template-columns: 1fr 1fr; } .step:nth-child(3) { border-left: 0; padding-left: 0; } .step:nth-child(n+3) { border-top: 1px solid #bca99a; } .closing { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .shell { width: calc(100% - 36px); } .top { height: 76px; } .brand { font-size: 21px; } .nav { gap: 0; } .nav .nav-button { padding: 11px 14px; font-size: 12px; } .hero { padding-top: 57px; padding-bottom: 65px; } h1 { font-size: clamp(46px, 11.2vw, 61px); line-height: 1.16; margin-top: 24px; } .hero-art { min-height: 470px; } .art-frame { inset: 0 0 0 4%; border-radius: 170px 170px 10px 10px; } .art-card { bottom: 38px; } .section { padding-block: 80px; } .section-head { margin-bottom: 35px; } .flow-head { display: block; } .steps { grid-template-columns: 1fr; } .step + .step { border-left: 0; border-top: 1px solid #bca99a; padding-left: 0; } .step { padding-block: 20px; } .step h3 { margin-top: 17px; } .closing { padding-block: 75px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <header class="shell top">
    <a class="brand" href="/" aria-label="Monexis — trang chủ"><span class="mark" aria-hidden="true">m</span>monexis<span>.</span></a>
    <nav class="nav" aria-label="Điều hướng chính"><a href="#features">Tính năng</a><a href="#how-it-works">Cách hoạt động</a><a class="nav-button" href="https://github.com/23092003e/commerce-ai-agent">Xem GitHub ↗</a></nav>
  </header>
  <main>
    <section class="shell hero">
      <div class="copy"><div class="eyebrow">A thoughtful commerce experience</div><h1>Bánh ngon.<br>Hội thoại<span class="accent">thông minh.</span></h1><p class="lead">Một AI agent dành cho tiệm bánh giả lập — kết nối Messenger với dữ liệu sản phẩm và tri thức để hỗ trợ khách hàng tự nhiên hơn.</p><div class="actions"><a class="button primary" href="https://github.com/23092003e/commerce-ai-agent">Khám phá dự án <span aria-hidden="true">↗</span></a><a class="button secondary" href="#how-it-works">Xem cách hoạt động <span aria-hidden="true">↓</span></a></div><p class="micro">DỰ ÁN PORTFOLIO &nbsp; / &nbsp; DỮ LIỆU GIẢ LẬP &nbsp; / &nbsp; KHÔNG CẦN THÔNG TIN CÁ NHÂN</p></div>
      <div class="hero-art"><div class="art-frame"><img src="/showcase/croissant.webp" width="1024" height="1536" alt="Bánh croissant lơ lửng trên bục, bao quanh bởi những vòng sáng màu đồng."><div class="art-index">MONEXIS STUDIO<br>THE BAKERY EDITION / 01</div></div><div class="art-card" aria-label="Ví dụ minh họa hội thoại"><div class="art-card-top"><span class="spark" aria-hidden="true">✳</span> MONEXIS ASSISTANT</div><p>“Butter Croissant giá bao nhiêu, còn hàng không?”</p><small>Ví dụ minh họa · Tra cứu từ dữ liệu mẫu</small></div></div>
    </section>
    <div class="strip"><div class="shell"><span><b>01 /</b> MESSENGER</span><span><b>02 /</b> CATALOG &amp; INVENTORY</span><span><b>03 /</b> RAG KNOWLEDGE</span><span><b>04 /</b> HUMAN HANDOVER</span></div></div>
    <section class="section shell" id="features"><div class="section-head"><div><div class="eyebrow">Made for meaningful conversations</div><h2>Phía sau một câu trả lời<br>là cả một hệ thống.</h2></div><p>Từ câu hỏi của khách đến dữ liệu đáng tin cậy: mỗi bước được thiết kế để AI hỗ trợ bán hàng có căn cứ và có người giám sát.</p></div><div class="features"><article class="feature"><div class="feature-number">01 / CATALOG <span class="feature-icon" aria-hidden="true">⌁</span></div><h3>Hiểu sản phẩm</h3><p>Tra cứu danh mục, giá và tồn kho từ cơ sở dữ liệu của cửa hàng mẫu.</p></article><article class="feature"><div class="feature-number">02 / KNOWLEDGE <span class="feature-icon" aria-hidden="true">✳</span></div><h3>Truy xuất tri thức</h3><p>RAG tìm kiếm tài liệu liên quan để hỗ trợ trả lời câu hỏi về chính sách của cửa hàng.</p></article><article class="feature"><div class="feature-number">03 / CONTROL <span class="feature-icon" aria-hidden="true">↗</span></div><h3>Luôn có người kiểm soát</h3><p>Chuyển cuộc hội thoại cho nhân viên khi thiếu thông tin hoặc hệ thống gặp lỗi.</p></article></div></section>
    <section class="section flow" id="how-it-works"><div class="shell"><div class="flow-head"><div><div class="eyebrow">From message to response</div><h2>Một hành trình.<br>Nhiều lớp kiểm soát.</h2></div><p>Một lát cắt của hệ thống AI bán hàng, từ tin nhắn đầu vào đến câu trả lời và bàn giao.</p></div><div class="steps"><article class="step"><span>01 / NHẬN TIN</span><h3>Messenger</h3><p>Webhook xác thực tin nhắn từ Meta và lưu sự kiện để xử lý.</p></article><article class="step"><span>02 / TÌM HIỂU</span><h3>AI &amp; công cụ</h3><p>Agent chọn công cụ phù hợp cho câu hỏi và ngữ cảnh hội thoại.</p></article><article class="step"><span>03 / TRUY XUẤT</span><h3>Dữ liệu &amp; RAG</h3><p>Tra cứu sản phẩm hoặc tài liệu có liên quan trước khi phản hồi.</p></article><article class="step"><span>04 / PHẢN HỒI</span><h3>Khách &amp; nhân viên</h3><p>Gửi câu trả lời hoặc chuyển tiếp khi cần sự hỗ trợ của con người.</p></article></div></div></section>
    <section class="shell closing"><div><div class="eyebrow">Explore the project</div><h2>Từ ý tưởng đến triển khai.</h2><p>Khám phá kiến trúc, mã nguồn, các kịch bản kiểm thử và những giới hạn thực tế của dự án.</p><p class="notice"><strong>Về bản trình diễn:</strong> Monexis là cửa hàng giả lập; đơn hàng không giao hàng và không thanh toán thật. Messenger có thể chỉ dành cho tài khoản được cấp quyền thử nghiệm; dịch vụ miễn phí và nhà cung cấp AI đôi lúc phản hồi chậm hoặc không khả dụng.</p></div><a class="button primary" href="https://github.com/23092003e/commerce-ai-agent">Xem mã nguồn <span aria-hidden="true">↗</span></a></section>
  </main>
  <footer><div class="shell"><span>MONEXIS / COMMERCE AI AGENT</span><span>MỘT DỰ ÁN PORTFOLIO · 2026</span></div></footer>
</body>
</html>`;

export function registerShowcase(app: FastifyInstance): void {
  app.get('/', async (_request, reply) =>
    reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'strict-origin-when-cross-origin')
      .header(
        'content-security-policy',
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(showcase)
  );

  app.get('/showcase/croissant.webp', async (_request, reply) => {
    const image = await readFile(
      new URL('../../assets/croissant.webp', import.meta.url)
    );
    return reply
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .type('image/webp')
      .send(image);
  });
}
