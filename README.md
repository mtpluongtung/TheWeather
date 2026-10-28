# WeatherCast Studio – Hệ Thống AI Tạo Video Dự Báo Thời Tiết Việt Nam

**WeatherCast Studio** là ứng dụng web Full-Stack kết hợp **bản đồ địa lý 3D thật (MapLibre GL JS)**, **dữ liệu dự báo thời tiết thực tế (Open-Meteo API & RainViewer Radar, đối chiếu cảnh báo chính thức từ NCHMF)**, **kịch bản lời dẫn tiếng Việt tự nhiên**, **giọng đọc Neural TTS tiếng Việt (`edge-tts`)** và **pipeline ghi hình xuất video MP4 thực tế (Playwright Chromium + FFmpeg)**.

---

## 1. Kiến Trúc Hệ Thống & Nguyên Tắc Kỹ Thuật

1. **Bản đồ địa lý thật 100% (MapLibre GL JS)**:
   - Hiển thị vector/raster tiles thực tế từ **OpenFreeMap**, **Carto**, **OpenStreetMap** (và tùy chọn **MapTiler** qua `.env`).
   - Hỗ trợ **địa hình nổi 3D DEM thật** từ nguồn **AWS Open Data Terrain Tiles (Terrarium DEM)** kết hợp góc nghiêng camera 3D (`pitch`, `bearing`, `zoom`, `center`). Giao diện phân biệt rõ chế độ *Camera 3D Pitch* và *Địa hình 3D DEM Terrarium*.
   - Danh mục tọa độ thực WGS84 (`backend/data/places.json`) bao gồm các preset vùng miền (Toàn cảnh Việt Nam, Miền Bắc, Miền Trung, Tây Nguyên, Nam Bộ), các tỉnh/thành phố (Hà Nội, Bắc Ninh, Hải Phòng, Quảng Ninh, Lào Cai, Huế, Đà Nẵng, Khánh Hòa, Lâm Đồng, Đắk Lắk, TP. Hồ Chí Minh, Cần Thơ, Cà Mau, Phú Quốc...) và mốc chủ quyền **Quần đảo Hoàng Sa**, **Quần đảo Trường Sa**.
   - Thiết kế mở theo phiên bản hành chính `2025.2-VN-ADMIN` (ghi nhận đơn vị hành chính sáp nhập 2025 song song với tra cứu chi tiết địa phương).

2. **Nguồn dữ liệu thời tiết thực tế (`backend/services/weather.py`)**:
   - Dự báo số trị theo tọa độ: **Open-Meteo Forecast API** (`https://api.open-meteo.com/v1/forecast`, múi giờ `Asia/Ho_Chi_Minh`).
   - Lớp Radar mưa & mây vệ tinh: **RainViewer Public API** (`https://api.rainviewer.com/public/weather-maps.json`).
   - Tham chiếu cảnh báo chính thức: **Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (NCHMF)** (`https://www.nchmf.gov.vn/kttv/`). Hệ thống tách biệt rõ *dự báo từ mô hình số trị* với *bản tin cảnh báo thiên tai chính thức*, tuyệt đối không tự suy đoán hay bịa đặt cảnh báo bão/lũ.

3. **Sinh lời dẫn & Giọng đọc đồng bộ Camera (`script_generator.py`, `tts.py`, `camera_timeline.py`)**:
   - Hỗ trợ 4 phong cách lời dẫn: **Truyền hình chuyên nghiệp (`broadcast`)**, **Ngắn gọn (`concise`)**, **Thân thiện (`friendly`)**, **Chi tiết (`detailed`)**.
   - Hỗ trợ **Controlled Broadcast Template Engine** (hoạt động mặc định không cần khóa API, khớp 100% số liệu thật) và **LLM Adapter** tùy chọn (`LLM_PROVIDER=gemini` trong `.env`).
   - Tổng hợp giọng đọc tiếng Việt bằng `edge-tts` (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), đo thời lượng âm thanh thực tế của từng cảnh bằng `ffprobe`, tự động tính lại `start_time` / `end_time` của từng phân cảnh và tạo phụ đề `.srt` khớp từng khung hình.

4. **Kiến trúc Render Video MP4 (`backend/services/video_renderer.py`)**:
   - Mở trình duyệt **Chromium (Playwright)** ở chế độ Studio Render (`/?renderMode=1&projectId=...`) với WebGL (`preserveDrawingBuffer: true`).
   - Nạp trước (pre-warm) toàn bộ các ô bản đồ dọc theo hành trình bay.
   - Điều khiển camera MapLibre GL JS theo đúng hàm nội suy thời gian thực (`window.__seekWeatherCastFrame__(t)`), chụp chuỗi khung hình bản đồ thật đang chuyển động và đẩy trực tiếp qua ống dẫn `image2pipe` vào **FFmpeg** (`libx264`, `yuv420p`, `30 FPS`), ghép âm thanh giọng đọc + nhạc nền ambient (`aac`, `192kbps`).
   - Kiểm tra chất lượng đầu ra bằng `ffprobe` trước khi trả file MP4 cho người dùng tải về.

---

## 2. Cấu Trúc Thư Mục

```text
TheWeather/
├── backend/
│   ├── api/
│   │   └── routes.py            # Các REST API endpoints (/api/health, /api/places, /api/forecast, ...)
│   ├── data/
│   │   ├── places.json          # Tọa độ địa lý thực WGS84 & cấu hình hành chính Việt Nam
│   │   └── weathercast.db       # Cơ sở dữ liệu SQLite lưu dự án & lịch sử render
│   ├── output/                  # Thư mục chứa file MP4, WAV/MP3 TTS và phụ đề SRT
│   ├── services/
│   │   ├── weather.py           # Tích hợp Open-Meteo API, RainViewer Radar & tham chiếu NCHMF
│   │   ├── script_generator.py  # Sinh lời dẫn tiếng Việt & LLM Adapter
│   │   ├── tts.py               # Tổng hợp giọng đọc Edge TTS, ghép nhạc nền & tạo SRT
│   │   ├── camera_timeline.py   # Đồng bộ hóa đường bay 3D camera với thời lượng audio
│   │   └── video_renderer.py    # Pipeline Playwright Chromium + MapLibre + FFmpeg xuất MP4
│   ├── config.py                # Quản lý cấu hình từ biến môi trường (.env)
│   ├── database.py              # Lớp truy xuất SQLite
│   ├── models.py                # Pydantic schemas
│   └── main.py                  # Điểm khởi chạy FastAPI server
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── RealMapCanvas.tsx # Bản đồ 3D MapLibre GL JS + Lớp thời tiết + HUD Truyền hình
│   │   ├── services/
│   │   │   ├── api.ts            # Kết nối REST API
│   │   │   └── cameraMath.ts     # Nội suy chuyển động camera 3D & phụ đề
│   │   ├── types/
│   │   │   └── weathercast.ts    # TypeScript interfaces
│   │   ├── App.tsx               # Giao diện biên tập viên WeatherCast Studio
│   │   ├── index.css             # Giao diện Studio truyền hình hiện đại
│   │   └── main.tsx              # React entrypoint
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── tests/
│   └── test_weathercast.py      # Bộ kiểm thử tự động (Pytest)
├── .env.example                 # File mẫu cấu hình môi trường
├── requirements.txt             # Danh sách thư viện Python
├── start_studio.bat             # Script khởi chạy nhanh trên Windows (CMD)
├── start_studio.ps1             # Script khởi chạy nhanh trên Windows (PowerShell)
└── README.md                    # Tài liệu hướng dẫn
```

---

## 3. Hướng Dẫn Cài Đặt & Chạy Trên Windows 10/11

### Yêu cầu hệ thống
- **Windows 10 hoặc Windows 11** (64-bit).
- **Python 3.11 / 3.12 / 3.13** (Khuyên dùng Python 3.12 thông qua `py -3.12`).
- **Node.js 18+** và **npm**.
- **FFmpeg & FFprobe** đã cài đặt trong `PATH` hệ thống (kiểm tra bằng lệnh `ffmpeg -version`).

### Cách 1: Khởi chạy tự động bằng 1 cú nhấp chuột
Nhấp đúp vào file **`start_studio.bat`** hoặc chạy trên PowerShell:
```powershell
.\start_studio.ps1
```

### Cách 2: Cài đặt và chạy từng bước thủ công

**Bước 1: Tạo môi trường ảo Python và cài đặt thư viện**
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\playwright.exe install chromium
```

**Bước 2: Cấu hình file `.env`**
```powershell
copy .env.example .env
```
*(Mặc định hệ thống hoạt động đầy đủ ngay mà không bắt buộc phải điền API key trả phí).*

**Bước 3: Cài đặt và build Frontend**
```powershell
cd frontend
npm install
npm run build
cd ..
```

**Bước 4: Khởi động Backend & Frontend**
- Chạy Backend FastAPI (Terminal 1):
  ```powershell
  .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
  ```
- Chạy Frontend Vite Dev Server (Terminal 2):
  ```powershell
  cd frontend
  npm run dev
  ```
- Mở trình duyệt tại: **`http://127.0.0.1:5173`** (hoặc **`http://127.0.0.1:8000`** nếu đã chạy `npm run build`).
- Tài liệu OpenAPI (Swagger UI): **`http://127.0.0.1:8000/docs`**.

---

## 4. Hướng Dẫn Khắc Phục Lỗi Thường Gặp Trên Windows

1. **Lỗi WebGL hoặc màn hình bản đồ đen khi render ở chế độ Headless**:
   - Mặc định hệ thống đã cấu hình cờ `--use-gl=angle --use-angle=d3d11` tương thích với GPU Windows 10/11.
   - Nếu máy ảo hoặc card đồ họa cũ không hỗ trợ Direct3D11 trong tiến trình ẩn, hãy mở file `.env` và đổi:
     ```ini
     PLAYWRIGHT_GL_BACKEND=swiftshader
     ```
     hoặc đặt `PLAYWRIGHT_HEADLESS=false` để Chromium mở cửa sổ trực tiếp khi ghi hình.
2. **Lỗi `Python was not found` do Microsoft Store Alias**:
   - Sử dụng `py -3.12` hoặc tắt App Execution Aliases cho `python.exe` trong *Settings > Apps > Advanced app settings > App execution aliases*.
3. **Lỗi không tìm thấy `ffmpeg` hoặc `ffprobe`**:
   - Cài đặt FFmpeg qua Winget (`winget install Gyan.FFmpeg`) hoặc chỉ định đường dẫn tuyệt đối trong `.env` (`FFMPEG_BINARY=C:/path/to/ffmpeg.exe`).

---

## 5. Chạy Kiểm Thử Tự Động (Automated Tests)

```powershell
.\.venv\Scripts\pytest.exe tests/ -v
```
