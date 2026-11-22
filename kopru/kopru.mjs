#!/usr/bin/env node
// Kişisel Finans — bilgisayar köprüsü
// Telefondaki uygulamadan gelen fiş fotoğrafını / soruyu bu bilgisayardaki Claude Code'a (claude -p) iletir,
// cevabı uygulamaya geri döndürür. Ek paket gerektirmez (Node.js 18+).
//
// Güvenlik:
// - Yalnızca 127.0.0.1'de dinler; dışarıdan erişim Tailscale'in "serve" özelliğiyle (HTTPS) ve yalnızca sizin
//   Tailscale ağınızdan olur.
// - Her istek eşleştirme kodu ister; yalnızca Kişisel Finans uygulamasının adresine CORS izni verilir.
// - Gelen fotoğraf işten sonra silinir; hiçbir veri saklanmaz.
//
// Kullanım:  node kopru.mjs            (köprüyü başlatır, eşleştirme kodunu gösterir)
//            node kopru.mjs --kur      (Windows açılışında otomatik başlatmayı ekler)
//            node kopru.mjs --kaldir   (otomatik başlatmayı kaldırır)

import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOPRU_SURUMU = '1.0.0';
const VARSAYILAN_PORT = 8787;
const AZAMI_GOVDE = 15 * 1024 * 1024; // 15 MB
const ZAMAN_ASIMI = 5 * 60 * 1000; // 5 dakika
const IZINLI_KOKENLER = [/^https:\/\/fatihdlcgl42-jpg\.github\.io$/, /^https:\/\/kisisel-finans-app\.pages\.dev$/, /^https:\/\/[a-z0-9-]+\.kisisel-finans-app\.pages\.dev$/, /^http:\/\/localhost:\d+$/];

function kokenIzinli(koken) {
  return typeof koken === 'string' && IZINLI_KOKENLER.some((r) => r.test(koken));
}

function kodEsit(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Claude Code'u çalıştırır; istem stdin'den verilir (komut satırına kullanıcı metni konmaz). */
export function claudeCalistir({ istem, araclar, calismaDizini, komut = 'claude', zamanAsimi = ZAMAN_ASIMI }) {
  return new Promise((coz, reddet) => {
    const arg = ['-p', '--output-format', 'json', '--allowedTools', araclar.join(',')];
    const cocuk = spawn(komut, arg, { cwd: calismaDizini, shell: process.platform === 'win32', windowsHide: true });
    let cikti = '';
    let hata = '';
    const zamanlayici = setTimeout(() => {
      cocuk.kill();
      reddet(new Error('Claude zamanında cevap vermedi'));
    }, zamanAsimi);
    cocuk.stdout.on('data', (d) => (cikti += d));
    cocuk.stderr.on('data', (d) => (hata += d));
    cocuk.on('error', (e) => {
      clearTimeout(zamanlayici);
      reddet(new Error(`Claude Code başlatılamadı (${e.message}). Kurulu ve "claude" komutuyla açılıyor mu?`));
    });
    cocuk.on('close', (kodu) => {
      clearTimeout(zamanlayici);
      if (kodu !== 0) return reddet(new Error(`Claude hata verdi: ${(hata || cikti).trim().slice(0, 400) || 'bilinmeyen hata'}`));
      try {
        const j = JSON.parse(cikti);
        if (j.is_error) return reddet(new Error(`Claude hata verdi: ${String(j.result ?? '').slice(0, 400)}`));
        coz(String(j.result ?? ''));
      } catch {
        coz(cikti.trim());
      }
    });
    cocuk.stdin.end(istem);
  });
}

function jsonGonder(yanit, kod, govde, koken) {
  const basliklar = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (kokenIzinli(koken)) basliklar['Access-Control-Allow-Origin'] = koken;
  yanit.writeHead(kod, basliklar);
  yanit.end(JSON.stringify(govde));
}

function govdeOku(istek) {
  return new Promise((coz, reddet) => {
    let boyut = 0;
    const parcalar = [];
    // Sınır aşılırsa okumaya devam edilir ama saklanmaz; sonunda anlaşılır 413 yanıtı verilir.
    istek.on('data', (p) => {
      boyut += p.length;
      if (boyut <= AZAMI_GOVDE) parcalar.push(p);
    });
    istek.on('end', () => {
      if (boyut > AZAMI_GOVDE) return reddet(Object.assign(new Error('Fotoğraf veya istek çok büyük'), { durum: 413 }));
      try {
        coz(JSON.parse(Buffer.concat(parcalar).toString('utf8') || '{}'));
      } catch {
        reddet(Object.assign(new Error('Geçersiz istek'), { durum: 400 }));
      }
    });
    istek.on('error', reddet);
  });
}

/**
 * Köprü sunucusunu oluşturur (dinlemeye başlatmaz).
 * @param {{ kod: string, calismaDizini: string, claude?: typeof claudeCalistir }} ayar
 */
export function sunucuOlustur(ayar) {
  const calistir = ayar.claude ?? claudeCalistir;
  let kuyruk = Promise.resolve();
  // Aynı anda tek Claude işi çalışır.
  const sirayaKoy = (is) => {
    const sonuc = kuyruk.then(is, is);
    kuyruk = sonuc.catch(() => {});
    return sonuc;
  };

  return createServer(async (istek, yanit) => {
    const koken = istek.headers.origin;
    if (istek.method === 'OPTIONS') {
      if (!kokenIzinli(koken)) {
        yanit.writeHead(403);
        return yanit.end();
      }
      yanit.writeHead(204, {
        'Access-Control-Allow-Origin': koken,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      return yanit.end();
    }
    if (koken !== undefined && !kokenIzinli(koken)) return jsonGonder(yanit, 403, { hata: 'Bu adresten gelen isteklere izin yok' }, koken);
    const yetki = String(istek.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!kodEsit(yetki, ayar.kod)) return jsonGonder(yanit, 401, { hata: 'Eşleştirme kodu yanlış' }, koken);

    const yol = new URL(istek.url ?? '/', 'http://x').pathname;
    try {
      if (istek.method === 'GET' && yol === '/durum') {
        return jsonGonder(yanit, 200, { tamam: true, kopru: KOPRU_SURUMU }, koken);
      }
      if (istek.method === 'POST' && yol === '/fis') {
        const g = await govdeOku(istek);
        const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(g.resim ?? ''));
        if (!m) return jsonGonder(yanit, 400, { hata: 'Fotoğraf okunamadı' }, koken);
        const talimat = String(g.talimat ?? '').slice(0, 20000);
        const dosya = join(ayar.calismaDizini, `fis-${randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
        writeFileSync(dosya, Buffer.from(m[2], 'base64'));
        try {
          const metin = await sirayaKoy(() =>
            calistir({
              istem: `${talimat}\n\nŞu dosyadaki fiş/fatura fotoğrafını oku: ${dosya}\nKısa bir açıklamadan sonra kayıt kodunu tek bir json kod bloğu olarak ver.`,
              araclar: ['Read'],
              calismaDizini: ayar.calismaDizini,
            }),
          );
          return jsonGonder(yanit, 200, { metin }, koken);
        } finally {
          rmSync(dosya, { force: true });
        }
      }
      if (istek.method === 'POST' && yol === '/sor') {
        const g = await govdeOku(istek);
        const metin = String(g.metin ?? '').slice(0, 20000);
        if (!metin.trim()) return jsonGonder(yanit, 400, { hata: 'Soru boş' }, koken);
        const talimat = String(g.talimat ?? '').slice(0, 20000);
        const cevap = await sirayaKoy(() =>
          calistir({ istem: `${talimat}\n\n${metin}`, araclar: ['WebSearch', 'WebFetch'], calismaDizini: ayar.calismaDizini }),
        );
        return jsonGonder(yanit, 200, { metin: cevap }, koken);
      }
      return jsonGonder(yanit, 404, { hata: 'Bulunamadı' }, koken);
    } catch (e) {
      return jsonGonder(yanit, e.durum ?? 500, { hata: e.message }, koken);
    }
  });
}

function ayarDizini() {
  const kok = process.env.LOCALAPPDATA || join(homedir(), '.config');
  return join(kok, 'KisiselFinansKopru');
}

function ayarYukle() {
  const dizin = ayarDizini();
  mkdirSync(join(dizin, 'is'), { recursive: true });
  const dosya = join(dizin, 'ayar.json');
  if (existsSync(dosya)) {
    const a = JSON.parse(readFileSync(dosya, 'utf8'));
    if (typeof a.kod === 'string' && a.kod.length >= 16) return { ...a, dizin };
  }
  const a = { kod: randomBytes(12).toString('base64url'), port: VARSAYILAN_PORT };
  writeFileSync(dosya, JSON.stringify(a, null, 2));
  return { ...a, dizin };
}

function baslangicDosyasi() {
  return join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'kisisel-finans-kopru.cmd');
}

function anaIslem() {
  const arg = process.argv.slice(2);
  if (arg.includes('--kur') || arg.includes('--kaldir')) {
    if (process.platform !== 'win32') return console.log('Otomatik başlatma yalnızca Windows için.');
    if (arg.includes('--kaldir')) {
      rmSync(baslangicDosyasi(), { force: true });
      return console.log('Otomatik başlatma kaldırıldı.');
    }
    const betik = fileURLToPath(import.meta.url);
    writeFileSync(baslangicDosyasi(), `@echo off\r\nstart "Kisisel Finans Kopru" /min "${process.execPath}" "${betik}"\r\n`);
    return console.log('Tamam: Windows açıldığında köprü kendiliğinden başlayacak.');
  }
  const a = ayarYukle();
  const sunucu = sunucuOlustur({ kod: a.kod, calismaDizini: join(a.dizin, 'is') });
  sunucu.listen(a.port, '127.0.0.1', () => {
    console.log('');
    console.log('  Kişisel Finans köprüsü çalışıyor');
    console.log(`  Yerel adres: http://127.0.0.1:${a.port}`);
    console.log('');
    console.log(`  EŞLEŞTİRME KODU: ${a.kod}`);
    console.log('  (Bu kodu uygulamada Ayarlar → Bilgisayar köprüsü bölümüne girin.)');
    console.log('');
    console.log('  Bu pencere açık kaldıkça köprü çalışır. Kapatmak için pencereyi kapatın.');
  });
  sunucu.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${a.port} kullanımda; köprü zaten çalışıyor olabilir.` : e.message);
    process.exit(1);
  });
}

// Doğrudan "node kopru.mjs" ile çalıştırıldıysa başlat (testlerde içe aktarılınca başlamaz).
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) anaIslem();
