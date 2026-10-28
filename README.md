# ⚔️ ARES – Animated Military History Map Studio
> **Sa Bàn Tác Chiến Lịch Sử 3D – Hệ Thống Tự Động Hóa Sản Xuất Video Diễn Biến Chiến Dịch (Phong cách Kings and Generals & The Operations Room)**

Ares là studio sản xuất video lịch sử quân sự bán tự động: kết hợp **sa bàn 3D địa hình thực (MapLibre GL JS + DEM Terrarium)**, **mũi tên tác chiến uốn lượn động (Dynamic Curved Arrows)**, **biểu tượng đơn vị chuẩn NATO (NATO Military Counters)**, **vùng kiểm soát lãnh thổ co rút (Dynamic Frontline Pockets)**, **thuyết minh tiếng Việt hào hùng (Edge Neural TTS)** hòa âm cùng nhạc nền chiến trận, và **pipeline ghi hình từng khung hình chất lượng cao xuất file MP4 (Playwright Chromium + FFmpeg)**.

---

## 1. Tính Năng Chiến Thuật Chuyên Sâu

1. **Sa bàn địa hình 3D thực tế (3D DEM Terrain)**:
   - Tái tạo thung lũng Mường Thanh (Điện Biên Phủ), sông ngòi Rạch Gầm - Xoài Mút với tỷ lệ nổi địa hình 1.6x, thể hiện rõ thế đứng của pháo binh trên các sườn núi cao bao bọc thung lũng.
2. **Mũi tên chiến thuật tiến công động (Curved Tactical Arrows)**:
   - Thuật toán đường cong Bezier (De Casteljau) tính toán tiếp tuyến và sinh đầu mũi tên polygon quân sự có góc vát nhọn theo thời gian thực ($t$).
   - Đa dạng binh chủng: Mũi xung kích thọc sâu (`main_thrust`), mũi vu hồi đánh tạt sườn (`flanking`), vòng vây chiến hào đào lấn siết chặt (`encirclement`), bão lửa pháo binh (`artillery_barrage`).
3. **Biểu tượng quân sự chuẩn NATO (NATO Military Counters)**:
   - Ký hiệu chuẩn: Bộ binh ($\times$), Pháo binh ($\bullet$), Thiết giáp ($\bigcirc$), Sở chỉ huy ($\sqsubset$), Thủy binh.
   - Hiển thị cấp bậc quân đoàn (`XXX`), sư đoàn (`XX`), trung đoàn (`III`), tiểu đoàn (`II`).
   - Thanh đo quân số/máu trực quan biến đổi theo tương quan thương vong.
4. **Giao diện HUD Phim Tài Liệu Quân Sự (Military Documentary HUD)**:
   - **Tương quan lực lượng**: Thanh đo tỷ lệ chia đôi động (Việt Minh vs Quân Pháp), đồng hồ đếm thương vong thời gian thực, bảng tướng lĩnh chỉ huy.
   - **Chronometer lịch sử**: Hiển thị mốc thời gian lịch sử (`13/03/1954 - 17:05`) và đồng hồ chiến dịch $T+$.
   - **Mục tiêu chiến dịch**: Banner mục tiêu quân sự ngắn gọn của từng đợt tấn công.
   - **Hộp phụ đề 16:9 Cinematic**: Đặt tại đáy màn hình, font chữ rõ nét, viền mờ cao cấp chuẩn phim tư liệu.
5. **Bộ kịch bản lịch sử tích hợp**:
   - **Chiến dịch Điện Biên Phủ (1954)**: 4 đợt tiến công mở màn Him Lam, tiêu diệt Độc Lập - Bản Kéo, siết chặt vòng vây chiến hào cắt đứt sân bay, nổ bộc phá đồi A1 và bắt sống tướng De Castries.
   - **Trận Rạch Gầm - Xoài Mút (1785)**: Nguyễn Huệ dụ địch và dùng đại bác cù lao Thới Sơn kết hợp thuyền phục binh Rạch Gầm khóa đuôi chặn đầu, đại phá 5 vạn quân Xiêm.

---

## 2. Cách Khởi Động Nhanh (1 Click)

### Cách 1: Chạy bằng file tự động (Khuyên dùng trên Windows)
- **Cách đơn giản nhất**: Double-click vào file `start_studio.bat` (hoặc mở PowerShell gõ `.\start_studio.ps1`).
- Hệ thống sẽ tự động cấu hình môi trường, khởi động Backend + Frontend và mở trình duyệt tại `http://127.0.0.1:5173`.

### Cách 2: Chạy thủ công từ Terminal

Mở 2 cửa sổ terminal tại thư mục gốc của dự án:

**Terminal 1 (Backend API):**
```powershell
python main.py
# Hoặc: .\.venv\Scripts\python.exe main.py
```
> Server API chạy tại: `http://127.0.0.1:8000` (Docs: `http://127.0.0.1:8000/docs`)

**Terminal 2 (Frontend Studio):**
```powershell
npm run dev
```
> Web Studio chạy tại: `http://127.0.0.1:5173`

---

## 3. Cấu Trúc Dự Án

```text
TheWeather/
├── backend/
│   ├── api/
│   │   └── routes.py              # API kịch bản trận đánh (/api/scenarios, /api/scenarios/{id}/render, ...)
│   ├── data/
│   │   └── scenarios/             # Dữ liệu JSON kịch bản chiến dịch (Điện Biên Phủ, Rạch Gầm - Xoài Mút)
│   ├── services/
│   │   ├── tts.py                 # Neural TTS tiếng Việt hào hùng + tạo nhạc nền combat ambient BGM
│   │   └── video_renderer.py      # Pipeline Playwright Chromium + FFmpeg image2pipe render MP4
│   ├── config.py                  # Cấu hình hệ thống
│   ├── database.py                # Quản lý SQLite lưu trữ kịch bản & tiến trình render
│   ├── models.py                  # Pydantic schemas chuẩn quân sự
│   └── main.py                    # Điểm khởi chạy FastAPI
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── TacticalMilitaryCanvas.tsx # Sa bàn 3D MapLibre, mũi tên Bezier, ký hiệu NATO, nổ bộc phá
│   │   │   └── MilitaryDocumentaryHUD.tsx # HUD tương quan quân số, chronometer, mục tiêu, phụ đề 16:9
│   │   ├── services/
│   │   │   ├── api.ts                     # REST API client
│   │   │   ├── militaryTimelineEngine.ts  # Động cơ nội suy thời gian, camera slerp, bridge Playwright
│   │   │   └── tacticalArrowMath.ts       # Toán học giải tích mũi tên uốn lượn Bezier & đầu polygon
│   │   ├── types/
│   │   │   └── military.ts                # TypeScript interfaces
│   │   ├── App.tsx                        # Giao diện Military History Studio
│   │   └── index.css                      # Phong cách đồ họa quân sự cao cấp
├── tests/
│   ├── test_military_history.py   # Bộ kiểm thử kịch bản, âm thanh và pipeline render quân sự
│   └── test_weathercast.py        # Bộ kiểm thử cơ sở hệ thống
├── main.py                        # Điểm khởi động Backend tại thư mục gốc
├── package.json                   # Script npm tại thư mục gốc (npm run dev, npm run build)
├── start_studio.bat               # Khởi động 1-click Windows CMD
├── start_studio.ps1               # Khởi động 1-click Windows PowerShell
└── README.md
```

---

## 4. Kiểm Thử Hệ Thống (Pytest)

Chạy kiểm thử toàn bộ hệ thống bằng lệnh:
```powershell
.\.venv\Scripts\pytest.exe tests/test_military_history.py -v
```
Toàn bộ các bài test bao gồm kiểm tra dữ liệu chiến dịch WGS84, tổng hợp giọng nói thuyết minh tiếng Việt, hòa âm nhạc nền, và quy trình render MP4 đều đạt 100% thành công.
