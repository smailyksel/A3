/* Sesli Not: mikrofondan gelen sesi parça parça ana sayfaya aktarır.
   Ses işleme iş parçacığında çalışır; yaklaşık her 85 milisaniyede bir
   4096 örneklik parça gönderir. */

class KayitIsleyici extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tampon = new Float32Array(4096);
    this.dolu = 0;
  }

  process(girdiler) {
    const kanal = girdiler[0] && girdiler[0][0];
    if (!kanal) return true;
    let o = 0;
    while (o < kanal.length) {
      const n = Math.min(kanal.length - o, this.tampon.length - this.dolu);
      this.tampon.set(kanal.subarray(o, o + n), this.dolu);
      this.dolu += n;
      o += n;
      if (this.dolu === this.tampon.length) {
        this.port.postMessage(this.tampon.slice(0));
        this.dolu = 0;
      }
    }
    return true;
  }
}

registerProcessor('kayit-isleyici', KayitIsleyici);
