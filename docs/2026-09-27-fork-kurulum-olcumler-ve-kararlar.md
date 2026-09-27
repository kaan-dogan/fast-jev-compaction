# fast-jev-compaction fork'u — kurulum, ölçümler ve açık kararlar

**Tarih:** 2026-09-24 → 2026-09-27  
**Kimin için:** Kaan (ve bu fork'a sonra dokunacak her ajan)  
**Durum:** eklenti kurulu ve çalışıyor (0.5.1). Ancak dolu bir oturum üzerinde yapılan ölçüm,
**Jev'in bu hâliyle hiçbir seçim yapmadığını** gösterdi. Nasıl devam edileceği henüz
kararlaştırılmadı (en alttaki bölüm).

---

## 1. Ne istendi

Claude Code'da `/compact`, konuşmayı bir modele özetletmek yerine TypeSafe **Jev**'in
tut/at kararlarıyla küçültsün. Terminalde de masaüstü uygulamasında da çalışsın.

Rehberin verdiği ayarlar (`~/.claude/settings.json`):

```jsonc
"env": {
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
  "TYPESAFE_API_KEY": "<vck_… — Vercel AI Gateway anahtarı>",
  "TYPESAFE_BASE_URL": "https://ai-gateway.vercel.sh/v1/evaluate"
},
"pluginConfigs": {
  "fast-jev-compaction@fast-jev-compaction": {
    "options": { "compactAtPercent": 30, "keepThreshold": 0.5, "preserveRecentMessages": 6,
                 "minReductionRatio": 0.25, "truncateHeadChars": 300 }
  }
}
```

## 2. Neden fork

Upstream (`tamaratran/fast-jev-compaction`, 0.3.0) bu kurulumu **hiçbir sürümünde desteklemiyor**:

- Hook `TYPESAFE_BASE_URL`'i okumuyor. Adres ayarı yalnız kütüphanede (`src/request.ts`) var,
  `/compact`'ı yöneten hook'a bağlanmamış. İstekler her zaman `api.typesafe.ai`'ye gidiyor.
- Vercel AI Gateway'in biçimi farklı: model `typesafe-ai/jev` (eklenti `jev-latest` yolluyor),
  soru tipi `boolean` (eklenti `noul` yolluyor), cevap `{ type: 'boolean', probability }`
  (eklenti `{ noul }` bekliyor).
- `vck_` anahtarı TypeSafe'e gidince **401** alıyor. Terminalde görülen
  "fallback … Jev request failed (401)" hatası buradan geliyordu. Anahtar bozuk değildi.
- TypeSafe'in kendisinden anahtar almak mümkün değil; kayıtlar kapalı.

Upstream'de aynı işi yapan en az yedi açık PR var, en yakını **#74** "Adding the Vercel AI
Gateway, speak both Jev APIs from the hook". Ötekiler: #23, #84, #90, #94, #95, #96. Eklentinin
sahibi hiçbirini birleştirmemiş. Sekizinci bir PR açılmadı; #74'e yorum bırakmak önerildi, onay
bekliyor.

Fork: **github.com/kaan-dogan/fast-jev-compaction**, `main` dalı. Claude Code'un eklenti kaynağı
bu fork'a çevrildi (`claude plugin marketplace add kaan-dogan/fast-jev-compaction`).

## 3. Fork'taki değişiklikler

| Sürüm | Commit | Ne |
|---|---|---|
| 0.4.0 | `bec79fc` | Vercel AI Gateway desteği. Hook `TYPESAFE_BASE_URL` değerini (önce ortamdan, sonra settings `env` bloğundan) ya da yeni `baseUrl` ayarını okuyor. Adres `ai-gateway.vercel.sh` ise istek `typesafe-ai/jev` + `boolean` olarak gidiyor; `noulAnswer` gateway'in `probability` cevabını da kabul ediyor. |
| 0.5.0 | `5e1f61d` | **Silinen çağrının yerinde not** (`stubDroppedCalls`, hook'ta varsayılan açık). Assistant metnine şöyle bir satır ekleniyor: `[fast-jev-compaction removed a Read call {"file_path":…} and its 9775-char output; re-run it if the contents are needed]`. Ayrıca `examples/dry-run.ts` eklendi (bölüm 6). |
| 0.5.1 | `f8c5678` | Geçici hatalarda tekrar deneme. 429/502/503/504 alınırsa istek 1, 2 ve 4 sn bekleyerek üç kez daha deneniyor; hook, beklemeyi `$.clock.sleep` ile dispatch sinyaline bağlı yapıyor. |

Testler: 33/33 geçiyor. `claude plugin validate` temiz; hook'un okuduğu ortam değişkenleri
`TYPESAFE_API_KEY` ve `TYPESAFE_BASE_URL`.

## 4. Tuzaklar — hepsi bu çalışmada yaşandı

### 4.1 `$.env.get` değişken adla çağrılırsa modül HİÇ yüklenmez
İlk yerel yamada ortam değişkenini okuyan yardımcı fonksiyon `$.env.get(name)` diye yazılmıştı.
Motor, modülün okuduğu değişkenleri listeleyebilmek için sabit ad istiyor ve modülü yüklemeyi
reddediyor:

> hooks module fast-jev-compaction failed to load … `$.env.get takes a literal name as its first argument`

Hata masaüstünde **sessizdi**: `/compact` hiçbir uyarı vermeden normal özete düştü. Yalnız debug
log'unda görünüyor. Tip kontrolü (`tsc`) bunu yakalamıyor; `claude plugin validate` ve gerçek bir
oturum yakalıyor. **Her değişken kendi sabit adlı `$.env.get('…')` çağrısıyla okunmalı.**

### 4.2 Masaüstü uygulaması `settings.json`'daki `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`'u uygulamıyor
Bayrak **süreç ortamında** olmalı. Masaüstü için:

```bash
launchctl setenv CLAUDE_CODE_ENABLE_FUNCTION_HOOKS 1
```

Ardından uygulama tamamen kapatılıp açılmalı. Bu ayar **yeniden başlatmada kaybolur**; kalıcı
olması için bir LaunchAgent gerekir, henüz kurulmadı. Kontrol: `ps eww -p <claude pid>` çıktısında
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` görünmeli.

### 4.3 Marketplace'i kaldırmak `pluginConfigs`'i SİLER
`claude plugin marketplace remove fast-jev-compaction` eklentinin ayarlarını da siliyor. Değerler
elle geri yazıldı. Kaynağı değiştirmeden önce `settings.json`'u yedekle.

### 4.4 Masaüstünde "kept N/M messages" bildirimi görünmüyor
Eklenti sonucu `$.ui.toast` ve `$.ui.log` ile bildiriyor; masaüstü oturumunda ikisi de görünmedi.
Çalışıp çalışmadığı şöyle anlaşılıyor:

- **Eklenti çalıştıysa:** `/compact` 1–2 sn sürer, sonra özet gelmez, eski mesajlar olduğu gibi durur.
- **Normal özete düştüyse:** 20–40 sn sürer ve "This session is being continued…" diye başlayan bir özet gelir.

Kesin kanıt oturum dosyasındaki `compact_boundary` satırının `compactMetadata` alanı. Eklenti
çalıştıysa `durationMs` ≈ 1000 olur ve `preservedSegment` bulunmaz; normal özette `preservedSegment`
vardır.

### 4.5 Kararları görmenin tek yolu debug log
Karar satırları (`decisions: t1:Read:drop_call/call=0.16/result=0.09 …`) yalnız debug log'a
yazılıyor. Masaüstü oturumu debug log tutmuyor. Başsız bir oturumda şöyle görülebilir:
`claude -p "/compact" --resume <id> --debug-file x.txt`.

### 4.6 Eklenti güncellemesi yeniden başlatma ister
Marketplace'ten kurulan eklenti dosya değişikliğini izlemiyor. `claude plugin update …` sonrası
açık oturumlar eski sürümle devam ediyor.

## 5. Ölçümler

### 5.1 Uçtan uca (başsız Claude Code 2.1.281, Haiku, ~$0.10/koşu)
- 0.4.0: `kept 9/15 messages, no summary (75% reduction; 3 call_dropped, 2 pinned)` ve
  `session.compact (manual): a hook's 9 messages stand; core never ran`.
- 0.5.0: compact sonrası oturum dosyasında not satırı var:
  `removed a Read call {"file_path":".../README.md"} and its 9775-char output`.

### 5.2 Masaüstünde gerçek bir `/compact` ("Repo files review", auto-checkin, `107499f2`)
- 180 bin → 40 bin token, **1,1 sn**, özet yok. İlk kullanıcı mesajı kelimesi kelimesine duruyor.
- Dokunulabilen **7 çağrının 7'si atıldı**. Bunlara `checkin_watcher.py`'nin 56 KB'lık okuması ve
  45 KB'lık README/RUNBOOK okuması dahil. Kalanlar yalnız "son 6 mesaj" korumasına takılanlar.
  O sırada not özelliği henüz yoktu; atılanlardan geriye iz kalmadı.

### 5.3 Dolu oturum üzerinde deneme ("dry run") — auto-checkin `3335ff5f`
Bağlamın ~%65'i dolu (1M'in ~654 bin token'ı), 653 mesaj, **260 araç çağrısı**, 7 Jev isteği.

- Sonuç: **260 çağrının 260'ı atılıyor**, 0 tutuluyor, 0 korunuyor. Mesaj metni %75 küçülüyor
  (729 bin → 182 bin karakter).
- **Puanlar hiçbir zaman eşiğe yaklaşmıyor:**
  - Çağrıyı tut: 0.10–0.32 (45 tanesi 0.1'li, 210 tanesi 0.2'li, 5 tanesi 0.3'lü).
  - Çıktıyı tut: 0.00–0.18.
  - Eşik 0.5 olduğu için sonuç "bütün araç çıktılarını sil" kuralıyla birebir aynı.
- **Sıralamada bir anlam var:** en üstte CronCreate/CronDelete, `checkin_watcher.py` üzerindeki
  Edit'ler ve o dosyanın okumaları. Üzerinde çalışılan şeyler bunlar.
- **Eşiği düşürmek çözüm değil**, puanlar çok dar bir aralıkta toplanıyor:

  | Eşik | Notu kalan çağrı | Tam çıktısı kalan |
  |---|---|---|
  | 0.5 | 0/260 | 0/260 |
  | 0.3 | 5/260 | 0/260 |
  | 0.25 | 55/260 | 0/260 |
  | 0.2 | 215/260 | 0/260 |
  | 0.15 | 259/260 | 94/260 |

  0.05'lik bir fark, 55 çağrıyla 215 çağrı arasındaki farkı yaratıyor.
- Karakter sayısı yalnız mesajları kapsıyor. Bağlamın geri kalanı (sistem promptu, araç tanımları,
  CLAUDE.md, hafıza) sabit, yani gerçek token kazancı %75'ten küçük.

### 5.4 Vercel AI Gateway'in güvenilirliği (ölçüldü)
| Tarih | Sonuç | Anlamı |
|---|---|---|
| 09-26, ilk | 3 tekil istekten 1'i 503 | Servis kararsız. 6 isteklik bir compact'ın tamamının başarılı olma ihtimali ~%9'du (0.5.1'deki tekrar deneme bunun için eklendi). |
| 09-26, sonra | Sırayla 10/10 ve paralel 6/6 istek 429 | Upstream aşırı yüklü; bizim istek sayımızla ilgisi yok. Tekrar deneme bunu kurtarmıyor. |
| 09-27, ilk | 16/16 istek 403 *"Free tier users do not have access to this model"* | Ücretsiz kredi bitti; ücretli kredi gerekiyor. |
| 09-27, kredi sonrası | 16/16 istek 200 | Çalışıyor. |

Bu hataların her birinde gerçek `/compact` sessizce normal özete düşer.

## 6. Deneme aracı — gerçek bir oturumda, ona dokunmadan

```bash
cd ~/GitHub/fast-jev-compaction && npx tsx examples/dry-run.ts <oturum.jsonl> [--segment N] [--out dosya.txt] [--no-stubs]
```

- Oturum dosyaları: `~/.claude/projects/<klasör>/<oturum-id>.jsonl`.
- `--segment N`: N'inci `/compact`'tan önceki bölüm. Verilmezse şu anki bağlam, yani bir sonraki
  `/compact`'ın göreceği bölüm.
- Anahtar, adres ve ayarlar hook'la aynı yerden okunuyor: ortam → `settings.json`.
- Çıktı her çağrı için bir satır: karar, iki puan, çıktı boyu, araç, girdi. Altında toplam
  küçülme ve `/compact`'ın bu sonucu kullanıp kullanmayacağı. `--out` ile compact sonrası konuşma okunur hâlde dosyaya yazılıyor.
- ⚠️ **Bilinen fark:** "son 6 mesaja dokunma" kuralı araçta Claude Code'dan farklı sayıyor
  (araç, bir assistant cevabının bloklarını tek mesaj sayıyor). Oturum 107499f2'de araç
  `checkin_watcher.py`'yi korudu, gerçek compact atmıştı. Jev'in puanları ve karar mantığı aynı.

## 7. Bulgular ve açık kararlar

### 7.1 Soru "yeniden çalıştırılabiliyorsa at" diyor, ve neredeyse her çağrı buna uyuyor
Çıktı sorusu: *"…the assistant still needs its contents **and re-running the tool would not do**"*.
Neredeyse her çağrı yeniden çalıştırılabildiği için cevap hep "hayır" çıkıyor. Oysa her çağrı
gerçekten yeniden üretilebilir değil:

- **Değişiklik yapan çağrılar** (Edit, Write, CronCreate, deploy): tekrar çalıştırmak aynı şeyi bir
  kez daha yapar.
- **Zamanla değişen çıktılar** (log, `ps`, AWS/API durumu): tekrar çalıştırınca başka bir sonuç gelir.
- **Sonradan değişmiş dosyalar:** okuyup düzenlediğin bir dosyayı şimdi okumak eski hâlini vermez.
- **Pahalı çağrılar:** Kaan'ın itirazı buradan. Ücretli bir API çağrısının (ör. OpenAI'a 5 dolarlık
  bir koşu) çıktısı silinirse, sonuca tekrar ihtiyaç duyulduğunda para bir kez daha ödenir.
  **Bu risk varken eklenti kullanılamaz.**

### 7.2 Önerilen çözüm: hiçbir çıktıyı gerçekten silmemek (YAPILMADI)
Bağlamdan atılan her çıktı önce diske yazılsın (ör. `~/.claude/fast-jev-archive/<oturum>/<tool_use_id>.txt`),
not da o dosyanın yolunu versin. Böylece:

- Hiçbir şey kaybolmaz.
- Tekrar çalıştırma gerekmez; model dosyayı okur.
- Jev yanlış bir şeyi atarsa bedeli bir dosya okuma olur, bir API faturası değil.

Claude Code'un büyük çıktılar için yazdığı `<persisted-output> … Full output saved to …` aynı
mekanizma.

### 7.3 Jev'in katkısı şu an sıfır
Dolu oturumda bütün puanlar eşiğin altında kaldı; sonuç Jev'e hiç sormadan "hepsini at" demekle
aynıydı. Bu arada Jev'e bağımlılığın bedeli görüldü: 429, 503 ve 403. Arşivleme (7.2) eklenince
Jev'in hata bedeli sıfıra iniyor, ama seçim de yapmıyor. **Önerilen:** Jev'i çıkarıp kurala dayalı
bir compact'a geçmek. Son N mesaj dışındaki bütün araç çıktıları arşivlenir, yerlerinde not ve dosya
yolu kalır. Dış servis yok, anahtar yok, kredi yok.

**Karar bekliyor (Kaan):** Jev'siz kurala dayalı sürüm mü, yoksa Jev şart mı? Jev kalacaksa bir
sonraki adım soruları yeniden yazıp (7.1'deki ayrımlarla) aynı oturumda puan dağılımının açılıp
açılmadığını ölçmek. Maliyet: birkaç sentlik Jev isteği.

### 7.4 Normal `/compact` ile karşılaştırma
| | Normal `/compact` | fast-jev |
|---|---|---|
| Nasıl | Model bütün konuşmayı yapılandırılmış bir özete çeviriyor; sondaki bir parça (`preservedSegment`) aynen kalıyor | Araç çıktıları atılıyor; konuşma metni ve notlar aynen kalıyor |
| Süre | 20–38 sn (ölçüldü, 3 compact) | ~1–2 sn |
| Risk | Özet detay kaybettirebilir ya da çarpıtabilir. Bu çalışmada örneği yaşandı: özet, eklentinin yüklenmesini engelleyen yamayı "typecheck geçti" diye doğrulanmış gibi aktardı | Çıktılar gidiyor. Arşiv olmadan pahalı çıktılar kaybolur; konuşmanın kendisi çok uzunsa yeterince küçülmez ve normal özete düşer |

## 8. Upstream'e dönmek istenirse

```bash
claude plugin marketplace remove fast-jev-compaction   # ⚠️ pluginConfigs'i siler (4.3)
claude plugin marketplace add tamaratran/fast-jev-compaction
claude plugin install fast-jev-compaction@fast-jev-compaction
```

Upstream Vercel gateway ile çalışmaz (bölüm 2). #74 birleştirilene kadar fork'ta kalınmalı.

## 9. Güvenlik notu
`vck_` anahtarı bu çalışma sırasında sohbete iki kez yapıştırıldı ve terminal çıktısında göründü.
**Vercel'de yenilenmeli (rotate).** Anahtar hiçbir dosyaya ajan tarafından yazılmadı; yalnız
`~/.claude/settings.json` içinde duruyor.
