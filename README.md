# Pocket Hub - iPhone Uyumlu Çevrimdışı (Offline) PWA

Bu proje, **iPhone (iOS Safari)** cihazlarda standart bir yerel App Store uygulaması gibi çalışan, internet bağlantısı tamamen kesildiğinde (uçak modunda) dahi açılıp veri kaydedebilen ve **Vercel** platformuna sıfır konfigürasyonla yüklenmeye hazır tam teşekküllü bir PWA (Progressive Web App) projesidir.

---

## 🌟 Öne Çıkan Özellikler

- 📱 **iPhone ve Safari Özel Uyumluluğu**:
  - Dinamik Ada (Dynamic Island) ve Çentik (Notch) koruması (`viewport-fit=cover` & Safe Area Insets).
  - Apple Home Screen ikonu (`apple-touch-icon-180.png`).
  - Safari durum çubuğu ve tam ekran (`standalone`) modu.
  - iOS kullanıcılarına özel dahili *"Ana Ekrana Ekle"* yönlendirme kılavuzu.
- ⚡ **Tam Çevrimdışı (Offline) Çalışma**:
  - `sw.js` (Service Worker) ile tüm uygulama kabuğu ve varlıklar (HTML, CSS, JS, İkonlar) önbelleğe alınır.
  - İnternet yokken veya uçak modundayken anında açılır.
  - Notlar ve görevler yerel depolamada (`LocalStorage`) saklanır.
- 🚀 **Vercel Operasyonuna Tam Uyum**:
  - `vercel.json` içerisinde `sw.js` için `Cache-Control: max-age=0, must-revalidate` tanımlıdır; böylece güncellemeler Safari önbelleğinde takılmaz.
  - Statik varlıklar için yüksek hızlı CDN önbelleklemesi.

---

## 🚀 Vercel'de Yayınlama Rehberi (Operasyon)

Bu projeyi Vercel'e yüklemek için iki çok basit yöntem bulunmaktadır:

### Yöntem 1: GitHub / GitLab Üzerinden (Önerilen)

1. Bu klasörü (`C:\Users\admin\.gemini\antigravity\scratch\ios-pwa`) bir Git deposu olarak GitHub hesabınıza yükleyin:
   ```bash
   git init
   git add .
   git commit -m "Initial iOS PWA commit"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADINIZ/ios-pwa.git
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com) adresine gidin ve **"Add New Project"** butonuna tıklayın.
3. GitHub deponuzu seçin.
4. **Framework Preset**: *Other* seçili bırakın (Statik site olduğu için özel bir build komutuna gerek yoktur).
5. **Deploy** butonuna basın.
6. Yaklaşık 20 saniye içinde size özel bir `https://projeniz.vercel.app` adresi verilecektir!

---

### Yöntem 2: Vercel CLI ile Komut Satırından

Eğer bilgisayarınızda Node.js / Vercel CLI yüklüyse:
```bash
npx vercel
```
Komutunu çalıştırıp ekrandaki yönergeleri onaylayarak anında canlıya alabilirsiniz.

---

## 📲 iPhone'da Kurulum ve Offline Test Adımları

1. **Safari ile Açın**: iPhone'unuzdaki **Safari** tarayıcısını açın ve Vercel linkinize gidin (Örn: `https://projeniz.vercel.app`). *(Önemli: PWA kurulumu iOS'ta yalnızca Safari üzerinden yapılabilir).*
2. **Ana Ekrana Ekleyin**:
   - Safari ekranının altındaki **Paylaş** simgesine (`⬆️` kare içinden yukarı ok) dokunun.
   - Açılan sayfada aşağı kaydırıp **"Ana Ekrana Ekle"** (`➕`) seçeneğine dokunun.
   - Sağ üstteki **"Ekle"** düğmesine basın.
3. **Uygulama Olarak Başlatın**:
   - iPhone ana ekranınızda beliren **Pocket Hub** ikonuna dokunun.
   - Uygulama artık Safari adres çubuğu olmadan, bağımsız bir iOS uygulaması gibi tam ekran açılacaktır.
4. **Uçak Modunda Çevrimdışı Test**:
   - iPhone Denetim Merkezi'ni açıp **Uçak Modu**'nu (Airplane Mode) açın (Wi-Fi ve Hücresel veriyi kapatın).
   - Uygulamayı tamamen kapatıp ana ekrandan tekrar açın.
   - Uygulamanın anında açıldığını, sağ üstte *"Çevrimdışı"* rozetinin yandığını ve yeni not/görev ekleyip kaydedebildiğinizi göreceksiniz.

---

## 🔄 Yeni Sürüm / Güncelleme Yayınlama

Uygulamada bir değişiklik yaptığınızda:
1. `sw.js` dosyasındaki sürüm numarasını artırın (Örn: `v1.0.0` -> `v1.0.1`).
2. Değişikliklerinizi GitHub'a push edin (Vercel otomatik olarak yeni sürümü dağıtır).
3. Kullanıcılar uygulamayı açtığında ekranın üstünde *"✨ Yeni bir sürüm mevcut! [Yenile]"* bildirimi belirecek ve tek dokunuşla güncellenecektir.
