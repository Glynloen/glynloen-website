/* Contact signals for Google Analytics 4 (2026-10-05; written by hand, loaded by tools/analytics.py).
   email_click, phone_click, form_send, video_play. Runs only where the GA loader ran (glynloen.com).
   Never sends what a visitor typed: only which link, form or video, and the page. */
(function () {
  if (typeof window.gtag !== "function") return;
  var page = location.pathname;
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="mailto:"],a[href^="tel:"]');
    if (!a) return;
    var href = a.getAttribute("href");
    if (href.indexOf("mailto:") === 0) {
      gtag("event", "email_click", { email_to: href.slice(7).split("?")[0].toLowerCase(), page_path: page });
    } else {
      gtag("event", "phone_click", { page_path: page });
    }
  }, true);
  document.addEventListener("submit", function (e) {
    var f = e.target;
    gtag("event", "form_send", { form_id: (f && f.id) || "", page_path: page });
  }, true);
  [].forEach.call(document.querySelectorAll("video"), function (v) {
    v.addEventListener("play", function () {
      gtag("event", "video_play", { video_title: "Rick Bingham introduction", page_path: page });
    }, { once: true });
  });
})();
