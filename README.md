# PostPilot

Website Node.js tự động đăng bài lên nhóm/kênh Telegram theo lịch.
Gồm: landing page, trang đăng nhập, bảng điều khiển (bài đăng, nhóm, nhật ký, cài đặt).

- **Lịch**: một lần, hằng ngày, theo thứ trong tuần, lặp theo chu kỳ (≥ 5 phút), có múi giờ.
- **Nội dung**: văn bản, ảnh, HTML/MarkdownV2, nút link inline, gửi im lặng.
- **Nhiều nhóm** cùng lúc, nhật ký từng lượt gửi, nút "Gửi ngay", tạm dừng/tiếp tục.
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
git commit -m "PostPilot: initial commit"
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

- **Dữ liệu**: nếu mỗi lần deploy Hostinger tạo lại thư mục ứng dụng, `data/` trong thư mục code có thể mất. Đặt `DATA_DIR` ra ngoài thư mục deploy (VD `/home/<user>/postpilot-data`) và thỉnh thoảng bấm **Cài đặt → Tải bản sao lưu**. Hãy kiểm tra điều này bằng cách deploy lại một lần sau khi tạo dữ liệu thử.
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
