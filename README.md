# KingTele

Website Node.js tự động đăng bài lên nhóm/kênh Telegram theo lịch.
Gồm: landing page, trang đăng nhập, bảng điều khiển (bài đăng, nhóm, nhật ký, cài đặt).

- **Lịch**: một lần, hằng ngày, theo thứ trong tuần, lặp theo chu kỳ (≥ 5 phút), có múi giờ.
- **Nội dung**: văn bản, ảnh/GIF/video tải từ máy (ảnh ≤10MB, MP4 ≤50MB, lưu ở `DATA_DIR/uploads`), link ảnh, HTML/MarkdownV2, nút link inline, gửi im lặng.
- **Nhiều nhóm** cùng lúc, nhật ký từng lượt gửi, nút "Gửi ngay", tạm dừng/tiếp tục.
- **Nhiều thành viên**: ai cũng có thể tạo tài khoản (email + mật khẩu) và dùng bot Telegram riêng của mình. Dữ liệu, nhóm, ảnh và nhật ký của mỗi người tách biệt. Tài khoản admin (biến `ADMIN_USERNAME`/`ADMIN_PASSWORD`) có trang **Thành viên** để khoá, đặt lại mật khẩu hoặc xoá tài khoản. Đặt `REGISTRATION_OPEN=0` để đóng đăng ký. Giới hạn mỗi tài khoản: 30 nhóm, 100 bài, 300MB ảnh/video (chỉnh bằng biến môi trường).
- **Quản trị**: tài khoản admin chính (biến môi trường) có thể cấp quyền quản trị cho thành viên khác (nút "Cấp QT"). Quản trị viên xem điểm, cộng/trừ điểm, khoá thành viên; chỉ admin chính mới thao tác được với quản trị viên khác. Trang Thành viên có ô **Giới hạn tài khoản mỗi IP** (để trống = không giới hạn).
- **Điểm King**: đăng ký tặng 500 điểm; mỗi lượt gửi thành công tới 1 nhóm trừ 1 điểm; điểm danh +50/ngày; giới thiệu bạn (link `/register?ref=MÃ`): khi người được giới thiệu chạy bài thành công lần đầu thì người giới thiệu +1000, người được giới thiệu +1000 (tổng 1500), với điều kiện **khác IP**. Số điểm chỉnh bằng biến môi trường (xem `.env.example`). Admin không bị trừ điểm và có thể cộng/trừ điểm cho thành viên ở trang Thành viên.
- **Hướng dẫn kết nối Telegram** ngay trong Cài đặt (5 bước, hình minh hoạ, cách lấy Chat ID nhóm riêng tư) và nút **Tìm nhóm bot đã thêm** ở trang Nhóm (dùng `getUpdates`, Telegram chỉ giữ ~24 giờ, không dùng được nếu bot đang gắn webhook).
- **Công cụ miễn phí `/cong-cu/lay-id-nhom-telegram`** (không cần đăng nhập, chuẩn SEO tiếng Việt: title, meta, FAQ schema, sitemap/robots). Dán link nhóm công khai hoặc link tin nhắn riêng tư `t.me/c/...` để lấy Chat ID. Biến môi trường tuỳ chọn: `TOOL_BOT_TOKEN` (bot riêng cho công cụ, dùng token khác bot của bạn; bot báo ID khi được thêm vào nhóm, khi nhận tin chuyển tiếp từ kênh hoặc lệnh `/id`, rồi tự rời nhóm) và `TOOL_YOUTUBE_ID` (11 ký tự ID video YouTube để nhúng; bỏ trống thì ẩn mục video).
- **Facebook (nhóm): lịch nhắc + đăng nhanh.** Facebook không cho phần mềm tự đăng vào Nhóm (Group) bằng cách chính thức, và KingTele không dùng mật khẩu/phiên đăng nhập Facebook của ai. Thay vào đó: người dùng thêm nhóm Facebook (link) và hẹn giờ bài (một lần/hằng ngày/theo thứ). Đến giờ, bài vào mục **Đến hạn đăng** (huy hiệu trên menu) kèm nhắc qua bot Telegram của chính họ; họ bấm **Sao chép nội dung**, **Mở nhóm**, dán và tick **Đã đăng**. Không tốn Điểm King. Không có Group API chính thức nên không hứa tự động hoàn toàn; đăng tự động chỉ khả thi cho Fanpage qua Graph API (chưa làm).
- **Đa ngôn ngữ (15 + tiếng Việt)**: English, 简体中文, Español, हिन्दी, العربية (chữ phải→trái), Português, Русский, 日本語, 한국어, Deutsch, Français, Bahasa Indonesia, ไทย, Türkçe, Suomi. Ngôn ngữ tự chọn theo quốc gia (múi giờ của trình duyệt) khi trình duyệt chỉ để tiếng Anh mặc định, nếu không thì theo ngôn ngữ trình duyệt; khách đổi tay bằng ô chọn ngôn ngữ (lưu lại). Có thể xem thử bằng `?lang=ja`. Ngôn ngữ chưa hỗ trợ dùng tiếng Anh.
- **Ứng dụng cài trực tiếp (PWA)**: nút **Cài ứng dụng** trên trang chủ và trong menu bảng điều khiển cài KingTele về điện thoại/máy tính, không qua CH Play hay App Store. App chính là website (cùng tài khoản, cùng dữ liệu, cập nhật website là app cập nhật theo). Android/Windows/Mac (Chrome, Edge): cài một chạm; iPhone: Safari → Chia sẻ → Thêm vào MH chính. Cần HTTPS. Có **thanh mời cài nổi bật** ở mọi trang, chỉ hiện với khách chưa cài (ẩn khi đã cài; khách bấm × thì nhắc lại sau 1 ngày). Trang quản trị **Ứng dụng** (chỉ admin) thống kê lượt cài: tổng lượt cài, số thiết bị đang dùng app trong 7 ngày, lượt bấm nút cài, số thiết bị đã thấy thanh mời, biểu đồ 30 ngày, chia theo thiết bị và danh sách cài gần đây. Chỉ lưu mã thiết bị ngẫu nhiên + loại thiết bị, không lưu IP. Biểu tượng tạo bằng `node scripts/make-icons.js`.
- **Thống kê truy cập (admin → Truy cập)**: số người đang xem website ngay lúc này (tự cập nhật 15 giây), khách và lượt xem hôm nay so với hôm qua, số đăng ký và tỉ lệ đăng ký, biểu đồ 30 ngày, nguồn truy cập (Facebook, Google, Telegram, Zalo, trực tiếp...) và loại thiết bị. Ẩn danh: không lưu IP, không cookie theo dõi, tôn trọng Do Not Track, bỏ qua bot và quản trị viên. Ngày tính theo `DEFAULT_TIMEZONE`.
- **Không cần database**: dữ liệu lưu ở `DATA_DIR/db.json`. Chỉ 2 dependency (`express`, `dotenv`).

## Chạy local

```bash
npm install
cp .env.example .env      # sửa ADMIN_PASSWORD
npm start                 # http://localhost:3000
npm test
```

## Thiết lập bot Telegram

1. Chat với [@BotFather](https://t.me/BotFather) → `/newbot` → lấy token.
2. Vào **Cài đặt** trong dashboard, dán token → *Lưu & kiểm tra*. (Hoặc đặt biến `TELEGRAM_BOT_TOKEN`.)
3. Thêm bot vào nhóm (kênh: đặt bot làm admin có quyền đăng tin).
4. Vào **Nhóm Telegram** → thêm bằng `@username` hoặc Chat ID (`-100...`).

## Đẩy lên GitHub

```bash
git init
git add .
git commit -m "KingTele: initial commit"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Deploy lên Hostinger (Node.js Web App)

Cần gói Hostinger có **Node.js Web Apps** (Business / Cloud).

1. hPanel → **Websites → Add website → Node.js Apps → Import Git Repository**, chọn repo (cấp quyền GitHub).
2. Cấu hình build: Node **20 hoặc 22**, Install: `npm install`, Start: `npm start`, entry file: `server.js`.
3. Thêm **Environment variables**:

   | Biến | Giá trị |
   |---|---|
   | `NODE_ENV` | `production` |
   | `ADMIN_USERNAME` | tên đăng nhập tuỳ chọn |
   | `ADMIN_PASSWORD` | mật khẩu mạnh (bắt buộc) |
   | `TELEGRAM_BOT_TOKEN` | token bot (hoặc nhập trong Cài đặt) |
   | `DEFAULT_TIMEZONE` | `Asia/Ho_Chi_Minh` |
   | `DATA_DIR` | thư mục ghi được, nên nằm **ngoài** thư mục code (xem lưu ý) |

   Không cần đặt `PORT`: Hostinger tự cấp.
4. Deploy. Bật **auto-deploy** từ nhánh `main` để mỗi lần `git push` tự cập nhật.
5. Kiểm tra `https://<domain>/healthz` trả `{"ok":true}`, rồi đăng nhập tại `/login`.

### Lưu ý quan trọng

- **Dữ liệu** (đã tự xử lý): ở production, app tự lưu dữ liệu và file tải lên vào `~/kingtele-data` (ngoài thư mục code) và tự chuyển dữ liệu cũ sang đó. Phần dưới là thông tin bổ sung:
- **Dữ liệu (chi tiết)**: nếu mỗi lần deploy Hostinger tạo lại thư mục ứng dụng, `data/` trong thư mục code có thể mất. Đặt `DATA_DIR` ra ngoài thư mục deploy (VD `/home/<user>/kingtele-data`) và thỉnh thoảng bấm **Cài đặt → Tải bản sao lưu**. Hãy kiểm tra điều này bằng cách deploy lại một lần sau khi tạo dữ liệu thử.
- **Chạy 24/7**: bộ lập lịch chạy trong tiến trình Node. Gói hosting có thể dừng app khi không có lưu lượng; hãy kiểm tra app luôn "Running" (hoặc dùng uptime monitor ping `/healthz` mỗi 5 phút). Nếu cần độ tin cậy cao hơn, dùng VPS với `pm2`.
- **Chỉ chạy 1 instance** (không scale ngang) để tránh gửi trùng.
- Lịch lặp bị bỏ lỡ quá 10 phút (server tắt) sẽ bỏ qua lượt đó; bài một lần quá hạn sẽ gửi ngay khi server chạy lại.

## Cấu trúc

```
server.js          Express app, bảo mật header, khởi động scheduler
src/schedule.js    Tính lượt chạy kế tiếp (múi giờ, DST)
src/scheduler.js   Vòng lặp 15s gửi bài đến hạn
src/telegram.js    Telegram Bot API (sendMessage / sendPhoto, retry 429)
src/auth.js        Phiên đăng nhập ký HMAC, chống brute-force, chống CSRF
src/routes.js      REST API
src/store.js       Lưu JSON nguyên tử
views/             app.html, login.html, 404.html
public/            landing + assets (CSS, JS, sprite icon)
test/              node --test
```

## Bảo mật

Cookie `HttpOnly; SameSite=Strict; Secure`, giới hạn 5 lần đăng nhập sai/15 phút/IP, header `X-Requested-With` bắt buộc cho thao tác ghi, CSP chặt, token bot luôn bị che trong giao diện. Đây là app một quản trị viên, không có đăng ký người dùng.

## Thêm / sửa bản dịch

Văn bản gốc trong code là tiếng Việt; bản dịch nằm ở `i18n/src/*.txt` (mỗi khối: `= chuỗi tiếng Việt` rồi các dòng `mã| bản dịch`). Quy trình:

```bash
npm run i18n:keys   # quét giao diện, cập nhật i18n/keys.json (phát hiện chuỗi mới)
npm run i18n        # kiểm tra đủ chuỗi + đủ {0},{1}, rồi dựng public/assets/lang/*.js
```

`npm run i18n` báo lỗi nếu thiếu chuỗi, thiếu ngôn ngữ hoặc sai định dạng `**đậm**`/`mã`/link (phải giống hệt bản tiếng Việt). `node scripts/build-i18n.js --prune` xoá các khối dịch không còn dùng. Thêm một ngôn ngữ mới: thêm mã vào `LANGS` trong `scripts/build-i18n.js` và `public/assets/i18n.js`, thêm dòng dịch vào các file `.txt`, rồi chạy `npm run i18n`.
