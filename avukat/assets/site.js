(function () {
  "use strict";

  // Telif satırındaki yıl
  var yil = document.getElementById("yil");
  if (yil) yil.textContent = String(new Date().getFullYear());

  // "Kopyala" düğmeleri: panoya yazılamazsa metni seçili bırakır
  function sec(el) {
    var aralik = document.createRange();
    aralik.selectNodeContents(el);
    var secim = window.getSelection();
    secim.removeAllRanges();
    secim.addRange(aralik);
  }

  function bildir(dugme, metin) {
    var eski = dugme.getAttribute("data-etiket") || dugme.textContent;
    dugme.setAttribute("data-etiket", eski);
    dugme.textContent = metin;
    window.clearTimeout(dugme._zaman);
    dugme._zaman = window.setTimeout(function () {
      dugme.textContent = eski;
    }, 2200);
  }

  var dugmeler = document.querySelectorAll(".kopya[data-hedef]");
  Array.prototype.forEach.call(dugmeler, function (dugme) {
    dugme.addEventListener("click", function () {
      var hedef = document.getElementById(dugme.getAttribute("data-hedef"));
      if (!hedef) return;
      var metin = hedef.textContent.trim();
      var yedek = function () {
        sec(hedef);
        bildir(dugme, "Seçildi");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(metin).then(function () {
          bildir(dugme, "Kopyalandı");
        }, yedek);
      } else {
        yedek();
      }
    });
  });
})();
