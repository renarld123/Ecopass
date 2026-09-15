# EcoPass landing page CMS

This project includes a public EcoPass landing page and a real server-backed content dashboard. Text is persisted in `data/site-content.json`; uploaded images are stored in `uploads/`. The public page has no editing or upload controls.

## Run it

1. Copy `.env.example` to `.env`.
2. Replace `ADMIN_PASSWORD` with a strong private password. Without it, the public site still runs but admin sign-in stays locked.
3. Replace `SESSION_SECRET` with a long random value.
4. Run `npm start`.
5. Open `http://localhost:3000/` for the landing page and `http://localhost:3000/admin` for the dashboard.

In PowerShell, a quick setup is:

```powershell
Copy-Item .env.example .env
notepad .env
npm start
```

The dashboard supports editing all main landing-page text, uploading/replacing images, removing uploaded images to restore defaults, previewing the public page, and signing out. Saves use atomic file replacement. Admin sessions are signed, HTTP-only, same-site cookies; write endpoints require authentication and same-origin requests. Login attempts are rate limited, and uploaded files are checked by MIME type and file signature with a 5 MB limit.

## Production notes

Run this behind HTTPS and persist both `data/` and `uploads/` on durable storage. Back up those directories. Keep `.env` private. On Railway, attach a Volume, mount it at `/data`, and set `STORAGE_ROOT=/data`; EcoPass will keep content in `/data/data` and uploads in `/data/uploads`. The `/health` endpoint is available for deployment health checks. If deploying to a serverless host, replace the filesystem storage adapter with that host's database and object storage while preserving the API contract.

Run the automated checks with `npm test`.

## Payment logo credits

Payment marks are used only to identify available payment methods; their owners do not endorse EcoPass. The [GCash logo](https://commons.wikimedia.org/wiki/File:GCash_logo.svg), [Maya logo](https://commons.wikimedia.org/wiki/File:Maya_logo.svg), [Mastercard symbol](https://commons.wikimedia.org/wiki/File:Mastercard_2019_logo.svg), and [Visa logo](https://commons.wikimedia.org/wiki/File:Visa_Inc._logo_%282021%E2%80%93present%29.svg) are displayed without alteration. The Maya logo is credited to Maya Bank, Inc. and PayMaya Philippines, Inc. under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
