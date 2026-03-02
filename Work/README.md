# Anonymous Wall

A minimal anonymous posting demo built with vanilla frontend + Express backend.

## Features

- Create anonymous posts
- List posts by latest/hot
- Separate like/unlike actions per anonymous cookie id
- Sensitive-word masking on post content
- Basic rate limit for posting and liking
- Basic CORS allowlist + credentialed requests
- JSON file storage (demo use only)

## Run

```bash
npm install
npm run start
```

Backend starts on `http://localhost:8000` by default.

Open `index.html` with a local static server (for example `http://localhost:5500`).

## Environment Variables

- `PORT`: backend port (default: `8000`)
- `CORS_ORIGINS`: comma-separated allowlist origins
  - default mode is dev-friendly: allows `localhost/127.0.0.1` on any port and `file://` preview (`Origin: null`)
  - set this variable to enforce a stricter allowlist
  - set `CORS_ORIGINS=*` to allow all origins (not recommended for production)
- `DB_POSTS_FILE`: posts file path (default: `backend/posts.json`)
- `DB_LIKES_FILE`: likes file path (default: `backend/likes.json`)
- `SENSITIVE_WORDS`: extra sensitive words (comma-separated)
- `POST_LIMIT_WINDOW_MS` / `POST_LIMIT_MAX`: post rate limit window and max hits
- `LIKE_LIMIT_WINDOW_MS` / `LIKE_LIMIT_MAX`: like rate limit window and max hits

## Scripts

- `npm run start`: run backend
- `npm run dev`: run backend with watch mode
- `npm test`: run API tests

## Notes

This project still uses local JSON files for persistence and is intended for local demos, not production traffic.
