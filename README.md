# HeyKorean Image Renderer

Instagram 채용공고 이미지 자동 합성 API 서버

## API

### POST /render

**Request Body:**
```json
{
  "image_url": "https://...",
  "title": "소프트웨어 엔지니어를\n채용합니다.",
  "subtitle": "TX | 정규직"
}
```

**Response:** PNG 이미지 (1080x1350)

### GET /health

서버 상태 확인

## 로컬 실행

```bash
npm install
npm start
```

## n8n 연동

HTTP Request 노드:
- Method: POST
- URL: https://your-app.render.com/render
- Body Content Type: JSON
- Response Format: File

