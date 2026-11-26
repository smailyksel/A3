# Video İndir'in Windows üzerindeki denemesi. Depodaki VideoIndir.exe dosyasını
# gerçek bir Windows'ta çalıştırır: ilk kurulum, yerel bir örnek videonun
# indirilmesi, MP3'e çevirme, telefona dosya verme, açılışta başlatma ayarı,
# kendini yerleştirme ve masaüstü kısayolu sınanır. YouTube'dan gerçek indirme
# de denenir; ancak YouTube bu tür sunuculardan gelen istekleri çoğu kez
# geri çevirdiği için o adımın sonucu yalnızca bildirilir.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$depo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$exe = Join-Path $depo 'videoindir\VideoIndir.exe'
$gecici = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$veri = Join-Path $gecici 'vi-veri'
$inen = Join-Path $gecici 'vi-inen'
$medya = Join-Path $gecici 'vi-medya'
foreach ($d in $veri, $inen, $medya) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$sonuclar = [System.Collections.Generic.List[string]]::new()
function Gecti($ad) { $sonuclar.Add("GEÇTİ   $ad"); Write-Host "GEÇTİ   $ad" -ForegroundColor Green }
function Bilgi($ad) { $sonuclar.Add("BİLGİ   $ad"); Write-Host "BİLGİ   $ad" -ForegroundColor Yellow }
function Dogrula($kosul, $ad) {
  if (-not $kosul) { throw "KALDI   $ad" }
  Gecti $ad
}

$env:VIDEOINDIR_VERI = $veri
$env:VIDEOINDIR_KLASOR = $inen
$env:VIDEOINDIR_DENEME = '1'
$env:VIDEOINDIR_PENCERE = '0'
$env:VIDEOINDIR_YERLESME = '0'

$kapi = 47800
$script:kok = ''

function Yokla {
  try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$kapi/api/ping" -TimeoutSec 3).uygulama -eq 'videoindir' }
  catch { return $false }
}
function AcilmasiniBekle($saniye = 30) {
  $son = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $son) { if (Yokla) { return $true }; Start-Sleep -Milliseconds 300 }
  return $false
}
function KapanmasiniBekle($saniye = 20) {
  $son = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $son) { if (-not (Yokla)) { return $true }; Start-Sleep -Milliseconds 300 }
  return $false
}
function Api($ad, $govde = $null) {
  if ($null -eq $govde) { return Invoke-RestMethod -Uri "$script:kok/api/$ad" -TimeoutSec 30 }
  return Invoke-RestMethod -Uri "$script:kok/api/$ad" -Method Post -ContentType 'application/json' -Body ($govde | ConvertTo-Json -Compress) -TimeoutSec 150
}
function IsiBekle($id, $saniye = 180) {
  $son = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $son) {
    $is = (Api 'durum').isler | Where-Object { $_.id -eq $id }
    if ($is -and ($is.durum -eq 'bitti' -or $is.durum -eq 'hata')) { return $is }
    Start-Sleep -Milliseconds 700
  }
  throw "KALDI   iş zamanında bitmedi: $id"
}
function GunluguYaz($klasor) {
  $g = Join-Path $klasor 'gunluk.txt'
  if (Test-Path $g) { Write-Host "----- $g"; Get-Content $g -Encoding utf8 | Select-Object -Last 80 | ForEach-Object { Write-Host $_ } }
}

try {
  Dogrula (Test-Path $exe) 'program dosyası depoda'
  Write-Host ("dosya: {0:N0} bayt, SHA-256 {1}" -f (Get-Item $exe).Length, (Get-FileHash $exe -Algorithm SHA256).Hash)

  # ---------- 1. açılış ve ilk kurulum ----------
  Start-Process -FilePath $exe -ArgumentList '--arkaplan' | Out-Null
  Dogrula (AcilmasiniBekle) 'program açıldı ve yanıt veriyor'
  $ayar = Get-Content (Join-Path $veri 'ayar.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $script:kok = "http://127.0.0.1:$kapi/$($ayar.anahtar)"

  $baslangic = Get-Date
  $sonAdim = ''
  while ($true) {
    $k = (Api 'durum').kurulum
    if ($k.durum -eq 'hazir') { break }
    if ($k.durum -eq 'hata') { throw "KALDI   ilk kurulum: $($k.hata)" }
    if ($k.adim -and $k.adim -ne $sonAdim) { $sonAdim = $k.adim; Write-Host "kurulum: $($k.sira)/$($k.adet) $($k.adim)" }
    if (((Get-Date) - $baslangic).TotalMinutes -gt 12) { throw 'KALDI   ilk kurulum 12 dakikada bitmedi' }
    Start-Sleep -Seconds 1
  }
  Gecti ("ilk kurulum tamamlandı ({0:N0} sn)" -f ((Get-Date) - $baslangic).TotalSeconds)

  $araclar = Join-Path $veri 'araclar'
  $ffmpeg = Join-Path $araclar 'ffmpeg\ffmpeg.exe'
  $ffprobe = Join-Path $araclar 'ffmpeg\ffprobe.exe'
  Write-Host ("indirme motoru: " + (& (Join-Path $araclar 'yt-dlp.exe') --version))
  Write-Host ("betik çalıştırıcı: " + ((& (Join-Path $araclar 'deno\deno.exe') --version) | Select-Object -First 1))
  Write-Host ("birleştirme aracı: " + ((& $ffmpeg -version) | Select-Object -First 1))
  Dogrula ($LASTEXITCODE -eq 0) 'üç yardımcı program Windows''ta çalışıyor'

  $sayfa = Invoke-WebRequest -Uri "$script:kok/" -TimeoutSec 15
  Dogrula ($sayfa.StatusCode -eq 200 -and $sayfa.Content -match 'Video İndir') 'arayüz sayfası geliyor'
  $yanlis = Invoke-WebRequest -Uri "http://127.0.0.1:$kapi/yanlis-anahtar/api/durum" -SkipHttpErrorCheck -TimeoutSec 15
  Dogrula ($yanlis.StatusCode -eq 404) 'anahtarsız istek reddediliyor'

  # ---------- 2. yerel örnek video ----------
  Push-Location $medya
  & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1280x720:rate=25:duration=8' -f lavfi -i 'sine=frequency=440:duration=8' `
    -map 0:v -map 1:a -c:v libx264 -preset ultrafast -b:v 1000k -c:a aac -b:a 96k `
    -use_timeline 1 -use_template 1 -seg_duration 4 -adaptation_sets 'id=0,streams=v id=1,streams=a' -f dash 'Örnek kayıt.mpd'
  Pop-Location
  Dogrula ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $medya 'Örnek kayıt.mpd'))) 'örnek video üretildi'
  $sunucu = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', '18080', '--bind', '127.0.0.1', '--directory', "`"$medya`"" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $ornek = 'http://127.0.0.1:18080/%C3%96rnek%20kay%C4%B1t.mpd'

  $b = Api 'bilgi' @{ adres = $ornek }
  Dogrula ($b.baslik -eq 'Örnek kayıt') "video bilgisi alındı, Türkçe harfler doğru ('$($b.baslik)')"

  $id = (Api 'indir' @{ adres = $ornek; tur = 'video'; kalite = '720' }).id
  $is = IsiBekle $id
  Dogrula ($is.durum -eq 'bitti') "video indirildi: $($is.dosyaAdi) $($is.hata) $($is.ayrinti)"
  $dosya = Join-Path $inen $is.dosyaAdi
  Dogrula ((Test-Path -LiteralPath $dosya) -and (Get-Item -LiteralPath $dosya).Length -gt 100000) 'dosya kayıt klasöründe'
  $akislar = (& $ffprobe -v error -show_entries stream=codec_name -of csv=p=0 $dosya) -join ','
  Dogrula ($akislar -match 'h264' -and $akislar -match 'aac' -and $dosya.EndsWith('.mp4')) "görüntü ile ses tek MP4 dosyasında birleşti ($akislar)"

  $parca = Invoke-WebRequest -Uri "$script:kok/dosya/$id" -Headers @{ Range = 'bytes=0-99' } -TimeoutSec 30
  Dogrula ($parca.StatusCode -eq 206 -and $parca.RawContentLength -eq 100) 'dosya telefona parça parça verilebiliyor'
  Dogrula ("$($parca.Headers['Content-Disposition'])" -match 'attachment') 'dosya indirme olarak sunuluyor'

  $id2 = (Api 'indir' @{ adres = $ornek; tur = 'ses'; kalite = '720' }).id
  $is2 = IsiBekle $id2
  Dogrula ($is2.durum -eq 'bitti' -and $is2.dosyaAdi.EndsWith('.mp3')) "ses MP3 olarak indirildi: $($is2.dosyaAdi) $($is2.hata) $($is2.ayrinti)"
  $ses = (& $ffprobe -v error -show_entries stream=codec_name -of csv=p=0 (Join-Path $inen $is2.dosyaAdi)) -join ','
  Dogrula ($ses -match 'mp3') "dosya gerçekten MP3 ($ses)"

  # ---------- 3. açılışta başlatma ayarı ----------
  $calistir = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Api 'otomatik' @{ acik = $true } | Out-Null
  $deger = (Get-ItemProperty -Path $calistir -Name 'VideoIndir' -ErrorAction SilentlyContinue).VideoIndir
  Dogrula ($deger -eq "`"$exe`" --arkaplan") "açılışta başlatma kaydı yazıldı ($deger)"
  Dogrula ((Api 'durum').otomatik -eq $true) 'arayüz ayarı açık görüyor'
  Api 'otomatik' @{ acik = $false } | Out-Null
  $deger = (Get-ItemProperty -Path $calistir -Name 'VideoIndir' -ErrorAction SilentlyContinue).VideoIndir
  Dogrula ($null -eq $deger) 'açılışta başlatma kaydı silindi'

  # ---------- 4. telefondan kullanım ----------
  Api 'telefon' @{ acik = $true } | Out-Null
  Start-Sleep -Seconds 2
  $t = (Api 'durum').telefon
  Dogrula ($t.acik -and $t.adres) 'telefon bağlantısı açıldı, ağ adresi bulundu'
  $agKok = $t.adres.TrimEnd('/')
  $telDurum = Invoke-RestMethod -Uri "$agKok/api/durum" -TimeoutSec 15
  Dogrula ($telDurum.yerel -eq $false -and $null -eq $telDurum.telefon) 'ağ adresinden gelen istek telefon sayılıyor'
  $yasak = Invoke-WebRequest -Uri "$agKok/api/kapat" -Method Post -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 15
  Dogrula ($yasak.StatusCode -eq 403) 'telefon programı kapatamıyor'
  $kare = Invoke-WebRequest -Uri "$script:kok/qr.png" -TimeoutSec 15
  Dogrula ($kare.StatusCode -eq 200 -and "$($kare.Headers['Content-Type'])" -match 'image/png') 'karekod üretiliyor'
  Api 'telefon' @{ acik = $false } | Out-Null
  Start-Sleep -Seconds 2
  $kapali = $false
  try { Invoke-RestMethod -Uri "$agKok/api/ping" -TimeoutSec 4 | Out-Null } catch { $kapali = $true }
  Dogrula $kapali 'telefon bağlantısı kapatılınca ağdan ulaşılamıyor'
  Dogrula (Yokla) 'bilgisayarın kendisinden kullanım sürüyor'

  # ---------- 5. YouTube'dan gerçek indirme (sonuç yalnızca bildirilir) ----------
  # Serbest lisanslı (CC BY) bir kısa film; indirilmesine lisansı izin verir.
  $yt = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
  try {
    $yb = Api 'bilgi' @{ adres = $yt }
    Bilgi "YouTube video bilgisi alındı: '$($yb.baslik)', $($yb.sure) sn"
    $yid = (Api 'indir' @{ adres = $yt; tur = 'video'; kalite = '720' }).id
    $yis = IsiBekle $yid 420
    if ($yis.durum -eq 'bitti') {
      $ya = (& $ffprobe -v error -show_entries stream=codec_name,height -of csv=p=0 (Join-Path $inen $yis.dosyaAdi)) -join ' '
      Bilgi ("YouTube'dan gerçek indirme BAŞARILI: {0}, {1:N0} bayt, akışlar: {2}" -f $yis.dosyaAdi, $yis.boyut, $ya)
    } else {
      Bilgi "YouTube'dan gerçek indirme bu sunucuda olmadı: $($yis.hata) | $($yis.ayrinti)"
    }
  } catch {
    $neden = "$($_.ErrorDetails.Message)"
    try { $neden = ($neden | ConvertFrom-Json).hata } catch { }
    Bilgi "YouTube bu sunucudan gelen isteği geri çevirdi: $neden"
  }

  # ---------- 6. kapatma ----------
  Api 'kapat' @{} | Out-Null
  Dogrula (KapanmasiniBekle) 'program kapatıldı'
  Start-Sleep -Seconds 1
  Dogrula ($null -eq (Get-Process -Name 'VideoIndir' -ErrorAction SilentlyContinue)) 'arkada işlem kalmadı'
  Dogrula ($null -eq (Get-Process -Name 'yt-dlp' -ErrorAction SilentlyContinue)) 'indirme motoru da kapandı'
  GunluguYaz $veri

  # ---------- 7. kendini yerleştirme, kısayol, pencere ----------
  $yer = Join-Path $gecici 'vi-yerlesik'
  New-Item -ItemType Directory -Force -Path $yer | Out-Null
  Copy-Item -Recurse -Force (Join-Path $veri 'araclar') (Join-Path $yer 'araclar')
  $env:VIDEOINDIR_VERI = $yer
  Remove-Item Env:VIDEOINDIR_YERLESME
  Remove-Item Env:VIDEOINDIR_PENCERE
  $masaustu = [Environment]::GetFolderPath('Desktop')
  $kisayol = Join-Path $masaustu 'Video İndir.lnk'
  Remove-Item -LiteralPath $kisayol -ErrorAction SilentlyContinue

  $ilk = Start-Process -FilePath $exe -PassThru
  Dogrula (AcilmasiniBekle) 'yerleşen kopya açıldı'
  $ilk.WaitForExit(15000) | Out-Null
  Dogrula $ilk.HasExited 'indirilen dosyadan başlayan işlem görevi devredip çıktı'
  $yerlesik = Join-Path $yer 'VideoIndir.exe'
  Dogrula (Test-Path $yerlesik) 'program kalıcı klasörüne kopyalandı'
  $calisan = @(Get-Process -Name 'VideoIndir' -ErrorAction SilentlyContinue)
  Dogrula ($calisan.Count -eq 1 -and $calisan[0].Path -eq $yerlesik) "çalışan tek işlem kalıcı klasördeki kopya ($($calisan.Path -join ', '))"
  Write-Host ("masaüstündeki kısayollar: " + ((Get-ChildItem -LiteralPath $masaustu -Filter '*.lnk' -ErrorAction SilentlyContinue).Name -join ', '))
  Dogrula (Test-Path -LiteralPath $kisayol) "masaüstü kısayolu Türkçe adıyla oluştu (Video İndir.lnk)"
  # Kısayol, adları Unicode okuyan kabuk nesnesiyle denetlenir.
  $oge = (New-Object -ComObject Shell.Application).Namespace($masaustu).ParseName('Video İndir.lnk')
  Dogrula ($null -ne $oge -and $oge.IsLink) 'dosya geçerli bir kısayol'
  $bag = $oge.GetLink
  Dogrula ($bag.Path -eq $yerlesik) "kısayol kalıcı kopyayı gösteriyor ($($bag.Path))"
  Dogrula ($bag.WorkingDirectory -eq $yer) "kısayolun çalışma klasörü doğru ($($bag.WorkingDirectory))"
  Dogrula (Test-Path (Join-Path $yer 'simge.ico')) 'kısayolun simge dosyası yerinde'
  try {
    $simgeYolu = ''
    $null = $bag.GetIconLocation([ref]$simgeYolu)
    if ($simgeYolu -like '*simge.ico') { Gecti "kısayol bu simgeyi kullanıyor ($simgeYolu)" } else { Bilgi "kısayolun simge yolu okunamadı ya da farklı: '$simgeYolu'" }
  } catch { Bilgi "kısayolun simge yolu okunamadı: $($_.Exception.Message)" }

  Start-Sleep -Seconds 4
  $pencere = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*--app=http://127.0.0.1:$kapi/*" })
  if ($pencere.Count -gt 0) { Bilgi 'pencere Edge ile adres çubuksuz açıldı' } else { Bilgi 'Edge penceresi bu sunucuda görülmedi (oturum ekranı olmayabilir)' }

  # ikinci kez çalıştırmak yeni bir kopya başlatmamalı
  $ikinci = Start-Process -FilePath $exe -ArgumentList '--arkaplan' -PassThru
  $ikinci.WaitForExit(15000) | Out-Null
  Start-Sleep -Seconds 1
  $calisan = @(Get-Process -Name 'VideoIndir' -ErrorAction SilentlyContinue)
  Dogrula ($ikinci.HasExited -and $calisan.Count -eq 1) 'ikinci kez çalıştırınca yeni kopya açılmıyor'

  $ayar2 = Get-Content (Join-Path $yer 'ayar.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $script:kok = "http://127.0.0.1:$kapi/$($ayar2.anahtar)"
  Dogrula ((Api 'durum').kurulum.durum -ne 'hata') 'yerleşik kopya çalışıyor'
  Api 'kapat' @{} | Out-Null
  Dogrula (KapanmasiniBekle) 'yerleşik kopya kapatıldı'
  GunluguYaz $yer

  # ---------- 8. Windows'un virüs taraması (sonuç yalnızca bildirilir) ----------
  $tarayici = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
  if (Test-Path $tarayici) {
    $cikti = & $tarayici -Scan -ScanType 3 -File $exe -DisableRemediation 2>&1 | Out-String
    $kod = $LASTEXITCODE
    $ozet = ($cikti -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 3) -join ' | '
    if ($kod -eq 0) { Bilgi "Windows Defender taraması temiz ($ozet)" }
    elseif ($kod -eq 2 -and $cikti -match 'found \d+ threats|Threat ') { Bilgi "Windows Defender dosyayı ŞÜPHELİ buldu: $ozet" }
    else { Bilgi "Windows Defender taraması yapılamadı (kod $kod): $ozet" }
  } else {
    Bilgi 'Windows Defender bu sunucuda yok'
  }
}
catch {
  Write-Host "$_" -ForegroundColor Red
  $sonuclar.Add("$_")
  GunluguYaz $veri
  if ($yer) { GunluguYaz $yer }
  $kaldi = $true
}
finally {
  Get-Process -Name 'VideoIndir', 'yt-dlp' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1:*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($sunucu) { Stop-Process -Id $sunucu.Id -Force -ErrorAction SilentlyContinue }
  if ($kisayol) { Remove-Item -LiteralPath $kisayol -ErrorAction SilentlyContinue }
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'VideoIndir' -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '================ ÖZET ================'
$sonuclar | ForEach-Object { Write-Host $_ }
if ($env:GITHUB_STEP_SUMMARY) {
  "### Video İndir, Windows denemesi`n`n``````text`n" + ($sonuclar -join "`n") + "`n``````" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Encoding utf8 -Append
}
if ($kaldi) { exit 1 }
