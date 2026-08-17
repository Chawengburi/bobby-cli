# 18 Spec: Uploader search ผ่าน auth-center — token เดียวที่ server, ตรวจสิทธิ์ที่ server

> **Status: DRAFT (2026-08-17)** — **ร่างที่ 3 เขียนใหม่ทั้งฉบับ** หลังทิศทางใหม่
> จาก team lead เหตุผลที่พลิกจากร่างที่ 2 อยู่ใน § 10
>
> **แทนที่ [spec 17](./17-spec-uploader-document-search.md) § 2 (auth), § 3.2
> (การรับ URL), § 3.3 (การจับคู่ error) และคำสั่ง `uploader login`** —
> ส่วนที่เหลือของ spec 17 (§ 3.1 validation + รูปแบบ `text`, § 3.4, § 5.3 กฎการ
> ตอบของ agent, § 6 ฉากทดสอบ) **ยังใช้ได้ทั้งหมดและ spec นี้อ้างถึงแทนการคัดลอกซ้ำ**
>
> **ยังไม่มีโค้ดอะไรถูกเขียน** ทั้งสองฝั่ง — `auth-center` ยังไม่มี route
> `/uploader/*` และ `bobby-cli` ยังไม่มี `src/commands/uploader.ts` (0.4.0)
>
> **ค่าภายในในเอกสารนี้เขียนเป็น placeholder** (`{{UPLOADER_HOST}}` ฯลฯ) เพราะ repo
> นี้เป็น public — ตารางแทนค่าอยู่ที่ `.specs-local.md` ที่ root ของ repo ซึ่ง
> **ถูก gitignore ไว้** (ต้นแบบ: `.specs-local.example.md`) agent ที่จะยิง request
> จริงต้องอ่านไฟล์นั้นก่อน

## 1. ข้อจำกัดที่กำหนดดีไซน์

1. **ไม่แก้โค้ดหรือ flow ของ uploader แม้แต่บรรทัดเดียว** — uploader เป็นระบบของ
   dev อีกคนในทีม ทำไปเกือบเสร็จแล้ว หน้าที่หลักคือป้อน dashboard ที่ทำงานกับ n8n
   การค้นเอกสารผ่าน chat เป็นผู้ใช้รายเล็กของระบบนั้น ไม่ใช่เจ้าของ
2. ใช้เฉพาะ **search** และ **อ่าน markdown ของผลลัพธ์** — ไม่เขียน ไม่อัปโหลด ไม่แก้ไข
3. **ผู้ใช้เฟสนี้คือ owner เท่านั้น** (ตัดสินใจโดย team lead 2026-08-17) —
   ยังไม่เปิดให้ staff
4. **ไม่ผูกกับ openClaw** — bobby-cli กับกฎการอนุญาตต้องใช้ได้กับ agent เจ้าอื่น
   ที่ยิง HTTP เป็น โดยไม่ต้องแก้อะไร (ข้อกำหนดใหม่ของ team lead)
5. **Discord guild อยู่ที่ priority ต่ำ** — เฟสนี้เล็งที่ 1-on-1 (DM) ผลที่ตามมา
   ต่อดีไซน์อยู่ใน § 9 ข้อ 3

## 2. Token 2 ชนิด — อ่านตารางนี้ก่อนอ่านอย่างอื่น

เอกสารรอบก่อนสับสนเพราะใช้คำว่า "token" กับของสองอย่างที่คนละเรื่องกัน

| | **Token A — ของ uploader** | **Token B — บัตรประจำตัวคน** |
|---|---|---|
| ใครออกให้ | dev เจ้าของ uploader (PocketBase) | auth-center |
| มีกี่ใบ | **1 ใบเท่านั้นทั้งระบบ** | 1 ใบต่อ 1 คน |
| อายุ | lifetime | ตามที่ auth-center กำหนด |
| เก็บที่ไหน | **env ของ auth-center** (`UPLOADER_TOKEN`) | เครื่องที่ login (`~/.bobby-cli/`) |
| รูปแบบ | token ของ PocketBase | `sm_live_...` |
| ตอบคำถามว่า | "ผู้เรียกมีสิทธิ์แตะ uploader ไหม" | "ผู้เรียก **คือใคร**" |
| ฝั่ง client เห็นไหม | ❌ **ไม่มีวันเห็น** | ✅ ถืออยู่แล้ววันนี้ |

**Token B ไม่ใช่ของใหม่** — คือ token ที่ `bobby-cli auth login` ได้มาแล้วใช้คุยกับ
session-memory ทุกวันนี้ (`src/core/authClient.ts:142-153`) spec นี้ **ไม่สร้าง
token ชนิดใหม่ ไม่เพิ่มไฟล์ credential ใหม่ ไม่เพิ่ม env ใหม่ฝั่ง client**

## 3. ภาพรวม

```
ผู้ใช้ (DM / agent ใดก็ได้)
   │
   ▼
bobby-cli uploader search "reservation"
   │  GET  {authCenterUrl}/uploader/search?...
   │  Authorization: Bearer sm_live_…        ← Token B จาก profile ที่ login ไว้
   ▼
auth-center  ← ด่านบังคับใช้สิทธิ์ "ที่เดียว"
   ├ 1. Token B → principal (ตรวจ revoked / expired / banned)
   ├ 2. roles ต้องมี "owner" ไม่งั้น 403 จบตรงนี้ ไม่ยิงต่อ
   └ 3. ผ่าน → ยิง uploader ด้วย Token A จาก env
        │  GET {UPLOADER_URL}/api/ai/search-files?...
        │  Authorization: Bearer {UPLOADER_TOKEN}     ← มี Bearer (Q-3)
        ▼
      uploader → ผลลัพธ์กลับทาง auth-center → bobby-cli → ผู้ใช้
```

**bobby-cli ไม่เคยยิง uploader โดยตรง** และ **ไม่เคยเห็น Token A**

ด่านอยู่หลังขอบเขต HTTP แปลว่า client เจ้าไหนก็เจอกฎเดียวกัน — bobby-cli,
agent เจ้าอื่น, หรือ `curl` ตรง ๆ ไม่มีทางเลี่ยงด้วยการเปลี่ยน client

## 4. อะไรเปลี่ยนจากร่างที่ 2

| | ร่างที่ 2 (ทิ้งแล้ว) | ร่างที่ 3 (ฉบับนี้) |
|---|---|---|
| Token A เก็บที่ | env ของ openClaw host (Hostinger) | **env ของ auth-center** |
| ใครยิง uploader | bobby-cli บน bot host | **auth-center** |
| ตรวจสิทธิ์ที่ไหน | bobby-cli (allowlist อีเมลใน env) | **auth-center (role จาก DB)** |
| ตรวจด้วยอะไร | `BOBBY_CLI_UPLOADER_ALLOW` เทียบอีเมล | `roles` ของ principal สด ๆ ทุก request |
| env ฝั่ง client | 3 ตัว | **0 ตัว** |
| เพิกถอนสิทธิ์รายคน | ลบอีเมลออกจาก env แล้ว restart | ปลด role / revoke token ผลทันที |
| ผูกกับ openClaw | ผูก (ประตูชั้น 2 อ่าน `BOBBY_CLI_PROFILES_DIR`) | **ไม่ผูก** |

**ตายไปจากร่างที่ 2 ทั้งหมด:** `BOBBY_CLI_UPLOADER_TOKEN`,
`BOBBY_CLI_UPLOADER_ALLOW`, `BOBBY_CLI_UPLOADER_URL`, ประตู 2 ชั้นฝั่ง client
(§ 5.3 ของร่างเดิม), และคำสั่ง `uploader login` ของ spec 17

## 5. ฝั่ง auth-center

### 5.1 env

| ตัวแปร | ชนิด | มีอยู่แล้วไหม | ไม่ตั้งแล้วเป็นยังไง |
|---|---|---|---|
| `UPLOADER_URL` | var | ✅ ประกาศไว้แล้วใน `src/auth.ts:14` + `wrangler.example.toml:12` | ทุก route ตอบ `503 uploader_not_configured` |
| `UPLOADER_TOKEN` | **secret** (`wrangler secret put`) | ❌ ต้องเพิ่มใน `interface Env` | เหมือนกัน — `503` ไม่ยิงเน็ต |

🔴 **`UPLOADER_URL` ต้องเป็น `https://` เท่านั้น** — ถ้าค่าที่ตั้งขึ้นต้นด้วย `http://`
ให้ทำตัวเหมือนไม่ได้ตั้ง (`503`) **เหตุผลไม่ใช่ความเคร่งครัด:** OpenAPI ของ uploader
ประกาศ `servers[0].url` เป็น **`http://{{UPLOADER_HOST}}`** (ดึงสด 2026-08-17)
ใครก็ตามที่ก๊อปค่านั้นมาวางจะทำให้ Token A วิ่งบนสายแบบไม่เข้ารหัสทุก request
(ยืนยันแล้วว่า `https://` ใช้งานได้จริง — เราดึง openapi ผ่าน https มา)

⚠️ `UPLOADER_URL` วันนี้ถูกใช้อยู่ที่ `src/ui.tsx:1447` แล้ว — ดู § 12 R-1 ก่อนตั้งค่า

⚠️ **uploader มีอินสแตนซ์เดียว แต่ auth-center มี 2 ตัว** (dev/test + production
ตาม `CLAUDE.md`) ทั้งคู่จะชี้ไป `{{UPLOADER_HOST}}` เดียวกัน ผลที่ตามมา
ต้องรู้ตัวก่อนเริ่ม — ดู § 12 R-5

### 5.2 Routes

ทั้งสอง route เป็น `GET` และอยู่ใต้ prefix `/uploader/` ที่ยังว่างอยู่ทั้งหมด
(ตรวจแล้ว 2026-08-17 — ไม่ชนกับ route ใดใน `app.ts`)

```
GET /uploader/search   ?query= &document_type= &source_system= &file_type=
                       &event_label= &day= &month= &date_from= &date_to= &limit=
GET /uploader/fetch    ?id=<pb_record_id>[&max_chars=<n>]

```

**ชื่อพารามิเตอร์ยืนยันสดจาก OpenAPI 2026-08-17** — ที่ต้องระวังคือ
**`query` ไม่ใช่ `q`** ส่วนที่เหลือเป็น snake_case ตรงกับของ uploader ทุกตัว จงใจ
ให้ตรงกัน 1:1 เพื่อไม่ต้องมีตารางแปลงชื่อให้ผิด

#### `/uploader/search`

ส่งต่อไปยัง `GET {UPLOADER_URL}/api/ai/search-files` โดย **ผ่านเฉพาะ 10
พารามิเตอร์ในรายการข้างบน** พารามิเตอร์อื่นถูกทิ้งเงียบ ๆ (ไม่ใช่ forward ทั้งก้อน)

🔴 **auth-center ต้อง validate เอง ห้ามเชื่อว่า client ตรวจมาแล้ว** — ด่านอยู่ที่นี่
แปลว่า `curl` ข้าม bobby-cli ได้ กฎขั้นต่ำที่ต้องบังคับฝั่ง server:

- `limit` — จำนวนเต็ม `1..50` ค่าเกินให้ **clamp ไม่ใช่ 400** (OpenAPI ของ uploader
  ประกาศ `maximum: 500` ซึ่งเป็นภาระที่เราไม่ควรยิงใส่ระบบของคนอื่น — ดู Q-6)
- `day` / `month` / `date_from` / `date_to` — ต้องตรงรูปแบบ `YYYY-MM-DD` /
  `YYYY-MM` ไม่ตรง → `400`
- ค่าของทุกพารามิเตอร์ยาวไม่เกิน 200 ตัวอักษร
- ต้องมี `query` หรือ filter อย่างน้อย 1 ตัว ไม่งั้น `400` (uploader ก็ 400 อยู่แล้ว
  แต่เราไม่ควรใช้ระบบของคนอื่นเป็นตัว validate ให้)

กฎที่เหลือของ spec 17 § 3.1 (enum ของ `document_type`/`source_system`, กฎ
mutually exclusive ของวันที่) ยังตรวจที่ bobby-cli เหมือนเดิมเพื่อให้ error สื่อกับ
คนใช้ — **auth-center ไม่ต้องตรวจซ้ำ** เพราะค่าที่ผิด enum อย่างมากก็ได้ผลลัพธ์ว่าง

คืน:

```json
{ "ok": true, "results": [ /* AIFileResult ตามที่ uploader ส่งมา */ ] }
```

**ยืนยันแล้ว 2026-08-17:** uploader ตอบ `{ "results": [AIFileResult] }` อยู่แล้ว →
auth-center **ยก array `results` ของมันมาวางใต้ envelope ของตัวเอง ห้ามห่อซ้อนสองชั้น**

🔴 **ถ้า body ของ `200` ไม่มี `results` ที่เป็น array → คืน `502 uploader_error`
ห้ามคืน `ok: true` ที่มี `results` ว่าง** นี่เป็นด่านเดียวที่จับได้ว่า uploader
เปลี่ยน API — ถ้าปล่อยผ่าน วันที่ dev เขาเปลี่ยนชื่อฟิลด์ บอทจะตอบ "ไม่พบเอกสาร
ที่ตรงกับคำถามนั้นครับ" กับทุกคำถามตลอดไป โดย `ok` เป็น `true` และ health check
เขียวสนิท ไม่มีใครรู้จนกว่าจะมีคนสังเกตเอง

ทุก object ข้างใน `results` ต้องเป็นของ uploader แบบไม่แตะต้อง — ไม่เพิ่มฟิลด์
ไม่ตัดฟิลด์ ไม่เรียงลำดับใหม่ (เงื่อนไข "verbatim" ของ spec 17 § 3.1 ที่ bobby-cli
พึ่งพาในการประกอบ `text`)

auth-center **ไม่ประกอบ `text` ไม่คำนวณ `mode` ไม่ทำ filter-first retry** —
ทั้งหมดนั้นอยู่ที่ bobby-cli ตาม spec 17 § 3.1 เหมือนเดิม เหตุผล: auth-center เป็น
**ด่านอนุญาต ไม่ใช่ตัวจัดรูปแบบ** ถ้ามันเริ่มตีความข้อมูล agent เจ้าอื่นที่อยากได้
ข้อมูลดิบจะใช้ไม่ได้ และเราจะมีที่ที่ต้องแก้ contract 2 แห่ง

#### `/uploader/fetch`

รับ **`id` เท่านั้น ไม่รับ URL เด็ดขาด** ทำ 2 ขั้นในตัวเอง:
`GET /api/files/{id}` → อ่าน `md_file_url` → ดึงเนื้อ markdown → คืน

```json
{ "ok": true, "id": "...", "record": { /* FileRecord ของ uploader ทั้งก้อน */ },
  "markdown": "...", "chars": 5820, "truncated": false }
```

**คืน `FileRecord` ทั้งก้อนใต้ `record` ไม่ใช่หยิบมาบางฟิลด์แล้วเปลี่ยนเป็น
camelCase** — ฉบับก่อนของสเปกนี้คืน `originalName`/`title` แบบหยิบมา ซึ่งขัดกับกฎ
"auth-center ไม่ใช่ตัวจัดรูปแบบ" ที่เพิ่งเขียนไว้ข้างบนเอง และทิ้ง `description`,
`index_status`, `time_events`, `tags` ที่ผู้บริโภครายอื่นอาจต้องใช้
`markdown` / `chars` / `truncated` เป็นของเราเพราะ uploader ไม่มีให้

- **`id` ที่รับคือ `pb_record_id` ของผลลัพธ์ search** — `AIFileResult` มี **ทั้ง
  `id` และ `pb_record_id`** (ยืนยัน 2026-08-17) และ `GET /api/files/{id}` รับตัวไหน
  ยังไม่เคยพิสูจน์ → **A-2 ต้องยิงจริงด้วยทั้งสองค่าแล้วบันทึกคำตอบลงสเปกนี้**
  ค่าเริ่มต้นที่ implement: ใช้ `pb_record_id` ถ้าไม่มีจึง fallback ไป `id`
- เรคอร์ดไม่มี `md_file_url` → `{ "ok": true, "mdReady": false, "id": "..." }`
  พร้อม HTTP `200` (คำถามถูกตอบแล้ว คำตอบคือ "ยังไม่มีอะไรให้ดึง")
- `max_chars` — จำนวนเต็ม clamp `1..200000` ไม่ส่งมาถือเป็น `200000`
  auth-center ตัดแบบดิบ ๆ แล้วตั้ง `truncated: true` **เพดานนี้มีไว้กัน markdown
  ก้อนใหญ่ทำให้ response ของ Worker บวม ไม่ใช่ตัวแทนของ `--max-chars`** — การตัด
  ที่ท้ายบรรทัดตาม spec 17 § 3.2 ยังเป็นงานของ bobby-cli และ CLI ส่งค่า
  `--max-chars` ของตัวเองมาเป็น `max_chars` ด้วยเพื่อไม่ต้องขนข้อมูลที่จะถูกทิ้งอยู่ดี

🔴 **origin guard ยังต้องมี แค่ย้ายเป้า** — ตอนแรกร่างนี้เขียนว่าการรับแค่ `id`
ทำให้ guard หายไปทั้งชั้น **ซึ่งไม่จริง**: `md_file_url` เป็น URL ที่ *เซิร์ฟเวอร์*
ให้มา และมันจะพาเราไป host ไหนก็ได้ กฎที่ต้อง implement:

- origin ของ `md_file_url` **ตรงกับ** `UPLOADER_URL` และเป็น `https` → ดึงพร้อม Token A
- **ไม่ตรง หรือไม่ใช่ `https` → ไม่ดึงเลย คืน `502 uploader_error`**

🔴 **ห้ามใช้ทางเลือก "ดึงแต่ไม่แนบ token"** ซึ่งเป็นสิ่งที่ฉบับก่อนของสเปกนี้เขียนไว้
— มันไม่ได้อะไรเพิ่มเลยแต่แลกมาด้วย **SSRF gadget**: `PATCH /api/files/{id}` มีอยู่
จริงบน uploader และถูกใช้โดย dashboard/n8n แปลว่าคนที่เขียน uploader ได้ (ซึ่ง
**ไม่ใช่กลุ่มเดียวกับ owner ของ auth-center**) ตั้ง `md_file_url` เป็น URL อะไรก็ได้
แล้ว auth-center จะกลายเป็นเครื่องดึง-แล้ว-ส่งต่อที่รันอยู่ใน Cloudflare account
ของเรา โดยผู้เรียกเป็นคนอ่าน response

สิ่งที่การรับแค่ `id` แก้ได้จริงคือ **ช่องที่ LLM เป็นคนป้อน URL เอง** (spec 17
§ 3.2) ซึ่งอันตรายกว่ามาก — นั่นหายไปจริง แต่ URL จากเรคอร์ดยังเป็นข้อมูลที่เรา
ไม่ได้ควบคุม จึงต้องปิดด้วยกฎข้างบน

#### ไม่มี `/uploader/health` — ตัดทิ้งโดยเจตนา

ฉบับก่อนของสเปกนี้มี route ที่สาม แต่ **ไม่มีทางเรียกถึงมันจาก CLI เลย** (§ 6.1 มี
2 คำสั่ง และ § 6.4 บอกว่า `schema/tools.json` ได้ 2 tool) — จะให้เรียกได้ต้องเพิ่ม
คำสั่งที่สาม ซึ่งไม่คุ้ม เพราะ **`uploader search -n 1` ตรวจได้ครบ 3 อย่างเท่ากัน
เป๊ะ ๆ**: auth-center ยังอยู่, env ตั้งครบ, Token A ยังไม่ตาย · ตอนนี้ `reason`
ใน envelope (§ 6.3) ทำให้ monitor แยกสาเหตุได้อยู่แล้วโดยไม่ต้องมี endpoint พิเศษ

### 5.3 การตรวจสิทธิ์ — ลำดับที่ห้ามสลับ

ทำก่อน subrequest ทุกครั้ง:

0. **rate limit ตาม IP ก่อนแตะ D1** — `ratelimit:uploader-ip:${ip}` 60 ครั้ง/5 นาที
   → เกิน `429 too_many_requests` · มีเพราะขั้นที่ 2 ยิง `SELECT` ลง D1 **ก่อน**
   ที่จะรู้ว่าผู้เรียกเป็นใคร ถ้าไม่ดักตรงนี้ คนที่ไม่มี token เลยก็สั่งให้เรา query
   D1 ได้ไม่จำกัด · ทุก route ที่มีอยู่แล้วของ auth-center ก็ทำแบบนี้ (`app.ts:721`)
1. **มี `Authorization: Bearer <token>` ไหม** → ไม่มี → `401 unauthorized`
2. **หา token row** ด้วย `getApiTokenByValue` (`src/auth.ts:243`) →
   ไม่พบ / `status === 'revoked'` / `expires_at` ผ่านแล้ว → `401 unauthorized`
3. **โหลด principal** → ไม่พบ / `banned` → `401 unauthorized`
4. **`principal_type` ต้องเป็น `'user'`** → machine token → `403 forbidden`
   (machine มี `roles: 'machine'` อยู่แล้วตาม `app.ts:710` จึงตกข้อ 5 อยู่ดี —
   ดักไว้ที่นี่เพื่อให้เหตุผลของการปฏิเสธชัด ไม่ใช่ผลข้างเคียง)
5. **`normalizeRoles(principal.roles).includes('owner')`** → ไม่ใช่ →
   `403 forbidden`
6. `updateApiTokenLastUsed(tokenRow.id)` แล้วจึงยิงต่อ

เขียนเป็น helper `requireOwnerToken(ac, c)` คู่กับ `requireMachineToken`
(`app.ts:595-604`) ที่มีอยู่ — **ห้ามเรียก `/auth/tokens/introspect` จากตัวเอง**
มันต้องใช้ `INTROSPECT_SECRET` และคืน `roles` ไม่ได้อยู่แล้ว (§ 11 Q-2)

**ทำไมตรวจ `roles` ไม่ใช่ `scopes`:** `VALID_SCOPES` (`src/auth.ts:19`) มีแค่
`memory:*` กับ `ai:use` — ไม่มี scope ของ uploader และการเพิ่ม scope ใหม่
กระทบ token ที่ออกไปแล้วทุกใบ ส่วน `roles` เป็นสิ่งที่ team lead พูดถึงตรง ๆ
(ข้อ 3) และอ่านสดจาก DB ทุก request → **ปลด owner วันนี้ ใช้ไม่ได้ทันที** ซึ่งเป็น
คุณสมบัติเดียวกับที่ introspect ตั้งใจรักษาไว้ (`app.ts:861-865`)

🔴 **`tenantId` ไม่ถูกตรวจ และนี่คือการตัดสินใจ ไม่ใช่การลืม** — auth-center เป็น
multi-tenant (`tenantId` ติดกับ user ทุกคน, `app.ts:661`) แต่ corpus ของ uploader มี
กองเดียวและไม่มีแนวคิดเรื่อง tenant เลย ดังนั้น **owner ของ tenant ไหนก็อ่านเอกสาร
ชุดเดียวกันทั้งหมด** วันนี้ไม่มีผลเพราะมี tenant เดียว แต่**วันที่โรงแรมที่สองถูก
onboard เป็น tenant ใหม่ owner ของเขาจะเห็น reservation list และ folio ของโรงแรมแรก
ทันทีโดยไม่มีใครแก้โค้ดอะไรเลยและไม่มีสัญญาณเตือน** → เป็น trigger ข้อ 6 ของ § 9
· ทางแก้เมื่อถึงวันนั้นคือเพิ่มเงื่อนไข `principal.tenantId === UPLOADER_TENANT_ID`
(env ใหม่, ไม่ตั้ง = `503`) หนึ่งบรรทัดใน `requireOwnerToken`

**`resource` ของ Token B ไม่ถูกตรวจในเฟสนี้** — token ที่ `auth login` ออกให้เป็น
`resource: "session-memory"` (`authClient.ts:153`) และเรายอมรับใบนั้น เหตุผลและ
สิ่งที่ต้องทำถ้าจะเปลี่ยน อยู่ใน § 11 Q-1

### 5.4 Rate limit

```
checkRateLimit(c.env.RATE_LIMIT_KV, `ratelimit:uploader:${tokenRow.id}`, 30, 5 * 60 * 1000)
```

เกิน → `429` ใช้ helper เดิม (`app.ts:613`) นับต่อ **token id ไม่ใช่ IP** เพราะ
ผู้เรียกจริงคือ bot host เครื่องเดียว IP จึงแยกคนไม่ได้

uploader เป็นระบบของคนอื่นที่มี n8n cron ใช้อยู่ — เราจะพยายามไม่เป็นสาเหตุที่ทำให้
มันล้ม (ตอบคำถาม Q-4 ด้วยการจำกัดฝั่งเราเอง ไม่ต้องรอคำตอบ)

⚠️ **เป็น best-effort ไม่ใช่การรับประกัน** — `checkRateLimit` ใช้ Workers KV ซึ่ง
eventually consistent request ที่เข้าพร้อมกันคนละ colo จะทะลุโควตาได้ · ยอมรับได้
เพราะเป็นการกันความผิดพลาดของเราเอง ไม่ใช่การกันคนที่ตั้งใจ (ซึ่งต้องมี Token B
ของ owner อยู่แล้ว) แต่ **ห้ามเขียนที่ไหนว่านี่คือเพดานที่ uploader พึ่งพาได้**

### 5.5 Timeout, retry, และการแปลง error — จุดที่ผิดง่ายที่สุดในสเปกนี้

**งบเวลาต้องบวกกันได้จริง** — ตัวเลขชุดนี้คิดจากเพดานปลายทาง ไม่ใช่ตั้งลอย ๆ

| ชั้น | ค่า | ที่มา |
|---|---|---|
| subrequest auth-center → uploader | **20 วิ** | uploader มี context timeout ของตัวเอง ~30 วิ (spec 17 § 3.3) |
| retry ที่ auth-center | **1 ครั้ง** (backoff 1 วิ + jitter) เฉพาะ 5xx / ต่อไม่ติด | |
| งบรวมของ 1 request ที่ auth-center | **≤ 41 วิ** | 20 + 1 + 20 |
| timeout ของ bobby-cli → auth-center | **45 วิ** | ต้องมากกว่างบข้างบน ไม่งั้น CLI ตัดสายตอนที่ server ยังทำงานถูกต้องอยู่ |

> ⚠️ ตัวเลขนี้แก้ความขัดแย้งที่ร่างแรกของหัวข้อนี้มี (25 วิ × 3 ครั้ง = 78 วิ แต่ CLI
> ตั้ง timeout 35 วิ ตาม spec 17 → CLI จะตัดสายเสมอก่อน server จะ retry เสร็จ
> แล้วรายงานเป็น `network` ทั้งที่ปัญหาคนละเรื่อง) **ห้ามเพิ่ม retry ที่ auth-center
> เป็น 2 ครั้งโดยไม่ขยับ 45 วิตาม**

> ⚠️ `uploader fetch` ยิง 2 subrequest ต่อกัน (record → markdown) **ต้องบังคับด้วย
> กลไก ไม่ใช่ด้วยตัวเลข**: สร้าง `AbortSignal.timeout(41_000)` **ครั้งเดียวตอนเข้า
> route** แล้วส่ง signal ตัวเดียวกันนั้นให้ทั้งสองขาและทุก retry · per-leg timeout
> ≤ 18 วิ · **ขาที่สอง (ดึง markdown) ไม่ retry** — ถ้าเขียนเป็น "20 วิ + retry 1
> ครั้ง ต่อขา" งบจะกลายเป็น 4×20+2 = 82 วิ ซึ่งเป็นบั๊กเดียวกับที่กล่องเตือนข้างบน
> บอกว่าแก้ไปแล้ว · และ **ฉากที่ 3 ของ spec 17 § 6 ยิง
> `search` + `fetch` ในเทิร์นเดียว** = สองคำสั่ง = worst case ~90 วิ + เวลาที่ model
> ใช้คิด ซึ่งเกิน turn timeout ของ agent เจ้าไหนก็ได้ → V-6 ของ spec 17 ยังต้องวัดจริง
> ก่อนสาธิต (ticket U07)

> **retry เกิดขึ้นที่ auth-center ที่เดียว** — bobby-cli **ห้าม** retry เมื่อได้ 5xx
> จาก auth-center (retry ได้เฉพาะตอนต่อ auth-center ไม่ติด) ไม่งั้นจำนวน request
> ที่ตกถึง uploader จะทวีคูณต่อคำสั่งเดียว

**ทุก error ต้องมี slug ที่อ่านด้วยเครื่องได้** — body รูปแบบเดียวตลอด
`{ "error": "<slug>", "message": "<ข้อความสำหรับคน>" }` และ **bobby-cli ต้อง
branch จาก `error` slug + HTTP status เท่านั้น ห้าม parse `message`**
(กฎเดียวกับที่ spec 12 บังคับกับ `code`)

| เกิดอะไรขึ้น | HTTP | `error` slug |
|---|---|---|
| ไม่มี/ผิด/หมดอายุ/ถูก revoke Token B | `401` | `unauthorized` |
| ไม่ใช่ owner หรือเป็น machine token | `403` | `forbidden` |
| พารามิเตอร์ผิดรูปแบบ (§ 5.2) | `400` | `bad_request` |
| `UPLOADER_TOKEN`/`UPLOADER_URL` ไม่ได้ตั้ง หรือไม่ใช่ https | `503` | `uploader_not_configured` |
| **uploader ตอบ `401`** (Token A ตาย/ถูกเพิกถอน) | **`502`** | `uploader_auth_failed` 🔴 **ห้ามคืน `401`** |
| **uploader ตอบ `404` — เฉพาะ `/uploader/fetch` เท่านั้น** | **`404`** | `not_found` |
| uploader ตอบ `404` บน `/uploader/search` | `502` | `uploader_error` |
| uploader ตอบ `429` | `429` | `uploader_rate_limited` |
| uploader ตอบ `4xx` อื่น | `502` | `uploader_error` |
| uploader ตอบ `5xx` / ต่อไม่ติด / timeout | `502` | `uploader_unavailable` |
| เกิน rate limit **ของเรา** | `429` | `too_many_requests` |

🔴 **แถว `404` เป็นของที่ร่างแรกตกไป** — `GET /api/files/{id}` ประกาศ `404` ไว้ใน
OpenAPI ชัดเจน (ยืนยัน 2026-08-17) ถ้าปล่อยให้ตกลงไปในกอง `502 uploader_error`
การถาม id ที่ไม่มีอยู่จะถูกรายงานว่า "ระบบมีปัญหา" ทั้งที่ระบบทำงานถูกต้อง และ
agent จะไปลองใหม่ซ้ำ ๆ แทนที่จะบอกผู้ใช้ว่าไม่พบ

🔴 **แต่แถวนี้ต้องผูกกับ `/uploader/fetch` เท่านั้น** — `/api/ai/search-files`
**ไม่ได้ประกาศ `404`** ไว้เลย (มีแค่ 200/400/401) ดังนั้น `404` จากขา search
แปลว่า path เพี้ยน (`UPLOADER_URL` มี path ต่อท้าย หรือ uploader ย้าย endpoint)
ถ้าเผลอ map เป็น `not_found` + exit 0 ตามแถวเดียวกัน **บอทจะตอบ "ไม่พบเอกสารที่ตรง
กับคำถามนั้นครับ" กับทุกคำถามตลอดไป โดย `ok: true` และ heartbeat เขียว** เป็น
โหมดพังที่เงียบที่สุดเท่าที่ดีไซน์นี้มีได้

**ทุก request ต้องมี log 1 บรรทัดแบบมีโครงสร้าง** — route, token id, upstream
status, เวลาที่ใช้, slug ที่เราคืน · **ห้ามมี token ทั้ง A และ B ในนั้น** ·
ไม่มีบรรทัดนี้แปลว่าเวลาสาธิตพังกลางเทิร์นจะแยกไม่ออกว่า "auth-center ปฏิเสธ token"
กับ "uploader timeout" ต่างกันตรงไหน (`wrangler tail` อยู่ในรันบุ๊กของ A-5)

**`429` แยกเป็น 2 slug โดยตั้งใจ** — `too_many_requests` แปลว่าเรายิงถี่เอง
(แก้ที่พฤติกรรมของเรา) ส่วน `uploader_rate_limited` แปลว่าโดนจากปลายทางซึ่งอาจมา
จาก n8n ของคนอื่น (แก้ไม่ได้ ต้องคุยกับ dev) — สองอย่างนี้ต้องแยกกันได้ตอน debug

🔴 **แถวที่สำคัญที่สุดคือแถว `502 uploader_auth_failed`** — ถ้า auth-center คืน
`401` ตอน Token A ตาย ผู้ใช้จะถูกส่งไป `bobby-cli auth login` ซึ่ง**เป็นคนละตัวตน
คนละระบบ และไม่มีทางแก้ปัญหานั้นได้เลย** (กฎเดิมจาก spec 17 § 5.3 ที่ยังใช้อยู่)
ต้องมี test ที่พิสูจน์ข้อนี้โดยเฉพาะ (§ 13 ข้อ 5)

**Error body ของ uploader ใช้ `status` ไม่ใช่ `code`** — ยืนยันสด 2026-08-11
ห้าม classify จาก `.code` (จะได้ `undefined`) ใช้ HTTP status เท่านั้น และอ่าน
ข้อความจาก `message` (spec 17 § 3.3)

### 5.6 กฎที่ห้ามผิด

- **`UPLOADER_TOKEN` ห้ามโผล่ใน response body, header, error message, หรือ log
  ทุกกรณี** รวมถึงตอน `502` ที่เราคัด `message` ของ uploader มาแสดง — ตัด message
  ที่ยาวเกิน 200 ตัวอักษรทิ้ง และห้าม echo request header กลับ
- **`/uploader/*` ห้ามมี method อื่นนอกจาก `GET`** — `PATCH /api/files/{id}` มีอยู่
  จริงบน uploader และเป็นสิ่งที่ข้อจำกัด § 1 ข้อ 2 ห้ามแตะ ไม่มีเส้นทางโค้ดไหนใน
  auth-center ที่ประกอบ request non-GET ไปยัง `UPLOADER_URL` ได้

## 6. ฝั่ง bobby-cli

### 6.1 คำสั่ง

```
bobby-cli uploader search [query] [ตัวกรองตาม spec 17 § 3.1] [-n <n>] [--json]
bobby-cli uploader fetch  <pb_record_id> [--max-chars <n>] [--json]
```

**ไม่มี `uploader login`** — ไม่มีอะไรให้ login ตัวตนมาจาก `bobby-cli auth login`
ที่มีอยู่แล้ว

**ไม่มี env ใหม่ ไม่มีไฟล์ credential ใหม่** — base URL มาจาก
`resolveAuthCenterUrl(creds.authCenterUrl)` (`src/core/config.ts:102-104`) ตัวเดียว
กับที่ทุก domain ใช้ ลำดับความสำคัญคือ

```
process.env.AUTH_CENTER  >  ค่าที่เก็บไว้ตอน login  >  DEFAULT_AUTH_CENTER_URL
```

🔴 **`AUTH_CENTER` ชนะค่าที่เก็บไว้ และเครื่องนี้ตั้งมันไว้แล้ว** —
`.claude/settings.local.json` ของ workspace ตั้ง `AUTH_CENTER=http://localhost:3000`
(คนละพอร์ตกับที่ `CLAUDE.md` เขียนไว้ว่า `:8787` ด้วย — เอกสารนั้นเก่า) **แปลว่า
ทุกคำสั่ง `bobby-cli uploader …` ที่รันจากใน session ของ Claude Code จะไม่ได้ยิงไป
auth-center ที่ profile ชี้ไว้เลย** มันจะไปที่ `localhost:3000` แล้วได้
`ECONNREFUSED` → รายงานเป็น `network` ซึ่งดูเหมือนเน็ตมีปัญหา ไม่เหมือนคอนฟิกผิด

ผลที่ตามมาที่ต้องทำ:
- **ทุกการทดสอบระหว่าง A-1…U08 ต้องยืนยันปลายทางก่อน** ด้วย `bobby-cli auth show --json`
  ตามกฎที่ `CLAUDE.md` เขียนไว้อยู่แล้ว — และดู `AUTH_CENTER` ในสิ่งแวดล้อมด้วย
- U05 ต้องมี test ที่พิสูจน์ลำดับนี้ (env ชนะค่าที่เก็บไว้) ไม่ใช่เดาเอา
- ⚠️ ถ้าใครตั้ง `AUTH_CENTER` เป็น production เครื่องนี้จะยิง production เงียบ ๆ
  เป็นความเสี่ยงชนิดเดียวกับที่ `CLAUDE.md` เตือนไว้เรื่อง `~/.bobby-cli/.env` หาย

**รับ `--profile <name>` เหมือนทุก domain** — ใช้ `resolveCredentialsPath(profile)`
(`config.ts:56`) ตัวเดียวกับ memory ไม่มีเส้นทางโหลด credential ของตัวเอง
· ไม่มี credential ของ profile นั้น → `not_logged_in` **ก่อนออกเน็ต**

### 6.2 อะไรจาก spec 17 ที่ยังใช้ อะไรที่ตาย

**ยังใช้ทั้งหมด:** validation ทุกข้อของ § 3.1 (enum, รูปแบบวันที่, กฎ mutually
exclusive, `-n ≤ 50`, ต้องมี query หรือ filter อย่างน้อยหนึ่ง), filter-first retry,
รูปแบบ `text` แบบ **ชื่อไฟล์ — คำอธิบาย**, การไม่แสดง `score`,
`[markdown not ready]`, การตัด `--max-chars` ที่ท้ายบรรทัด, § 3.4 ทั้งหัวข้อ

**ตาย:** `uploader login` และ code `logged_in` · การรับ `md_file_url` เป็น
อาร์กิวเมนต์ของ `fetch` และ origin guard (§ 5.2 — auth-center รับแค่ `id`) ·
`--token`/`--base-url` (ไม่เคยมี) · 401 re-auth-once (ไม่มี password ให้ใช้)

`[markdown not ready]` ยังตัดสินจากการมี `md_file_url` ใน `results` เหมือนเดิม —
CLI ตัดสินจากการมีอยู่ของมัน **แต่ห้ามให้มันโผล่ใน `text`** · ค่าของมัน**ยังอยู่ใน
`results` ของ `--json` แน่นอน** เพราะกฎ verbatim (§ 5.2) บังคับไว้ ดังนั้นมันอยู่ใน
context ของ agent อยู่แล้วทุกครั้งที่ search — กฎที่บังคับได้จริงคือกฎของ agent ใน
spec 17 § 5.3 ("ห้ามวาง URL ของ uploader ลงแชต") ไม่ใช่การแกล้งทำเป็นว่า CLI ซ่อนมัน

### 6.3 การจับคู่ error — ไม่มี code ใหม่

ต่อยอด [spec 12](./12-spec-agent-legible-output.md) ตรง ๆ

🔴 **หัวข้อนี้ "แก้" spec 12 / T03 สำหรับ route family `/uploader/*` โดยเฉพาะ
ไม่ใช่แค่ต่อยอด** — `src/core/classifyFailure.ts:47-55` มีกฎที่ตัดสินใจไว้แล้วว่า
**401 จาก auth-center ที่ไม่ใช่ตอน login ให้ตกเป็น `server`** พร้อมคอมเมนต์กำกับว่า
จงใจ ถ้า implementer เรียก `classifyAuthCenterFailure(err, "other")` ซึ่งเป็น
helper ที่ export ไว้สำหรับ error class นี้พอดี **ทุกเคส token หมดอายุจะกลายเป็น
`server` เงียบ ๆ** และ Done-when ข้อ 5 ก็ยังผ่าน (เพราะข้อนั้นต้องการ `server` อยู่แล้ว)
— ไม่มีอะไรจับได้เลย ผู้ใช้ที่ token หมดอายุจะไม่ถูกส่งไป login ตลอดกาล

**สิ่งที่ U02 ต้องทำให้ชัด:** เพิ่ม context ที่สามคือ `"uploader"` ให้
`classifyAuthCenterFailure` (401 → `not_logged_in`) **ห้ามใช้ `"other"` ซ้ำ** และ
ห้ามเขียน classifier ของตัวเองแยกอีกชุด

branch จาก `error` slug ของ § 5.5 ไม่ใช่จากข้อความ

| auth-center ตอบ | `code` ของ bobby-cli | exit | `hint` ต้องบอกให้ทำอะไร |
|---|---|---|---|
| `401 unauthorized` | `not_logged_in` | 1 | `bobby-cli auth login` — **ครั้งนี้ถูกต้อง** เพราะเป็น token ของผู้ใช้เอง |
| `403 forbidden` | `permission_denied` | 1 | ติดต่อ owner ขอสิทธิ์ · **ห้ามชวนไป login** |
| `400 bad_request` | `usage` | 1 | แก้พารามิเตอร์ · ถ้าเจอแปลว่า validation ฝั่ง CLI มีรู ให้แจ้งเป็นบั๊ก |
| **`404 not_found`** | **`not_found`** | **0** | ไม่มีเอกสาร id นั้น — ตอบผู้ใช้ว่าไม่พบ **ห้ามลองใหม่** (กฎเดียวกับ `not_found` ของ memory ใน T02) |
| `503 uploader_not_configured` | `server` | 1 | ติดต่อผู้ดูแล auth-center — ยังไม่ได้ตั้ง env |
| `502 uploader_auth_failed` | `server` | 1 | ติดต่อผู้ดูแล ให้เปลี่ยน `UPLOADER_TOKEN` · **ห้ามชวนไป login** |
| `502 uploader_error` / `uploader_unavailable` | `server` | 1 | uploader มีปัญหา ลองใหม่ภายหลัง |
| `429 too_many_requests` | `server` | 1 | ถามถี่เกินไป รอสักครู่ |
| `429 uploader_rate_limited` | `server` | 1 | uploader กำลังรับภาระอยู่ ลองใหม่ภายหลัง |
| ต่อ auth-center ไม่ติด / timeout (45 วิ) | `network` | 1 | |
| validation ฝั่ง client (spec 17 § 3.1) | `usage` | 1 | |

🔴 **envelope ของ bobby-cli ต้องมีฟิลด์ `reason` ที่คัด slug ของ § 5.5 มาตรง ๆ**
(นอกเหนือจาก `code`) — เพราะ 5 slug ของฝั่ง server ยุบรวมเป็น `code: "server"` หมด
ต่างกันแค่ข้อความ `hint` ซึ่งเครื่องอ่านไม่ได้ **ถ้าไม่มีฟิลด์นี้ health check ใน
§ 8 ทำงานไม่ได้เลย**: "Token A ตาย" กับ "uploader ล่มชั่วคราว 30 วิ" จะหน้าตา
เหมือนกันทุกตัวอักษร → monitor ต้องเลือกระหว่างเตือนทุกครั้งที่เน็ตกระตุก กับ
ไม่เตือนเลยตอนที่ควรเตือน · `reason` **ไม่ใช่ `code` ใหม่** จึงไม่แตะ enum ของ
`tickets/T02` และไม่ขัดกฎ "ไม่มี code ใหม่" ข้างบน

**`404 → not_found` แล้ว exit 0** ตามกฎเดิมของ `tickets/T02`: คำถามถูกตอบแล้ว
คำตอบคือ "ไม่มี" — ไม่ใช่ความล้มเหลว เหมือน `memory forget` ที่ id ไม่มีอยู่
ตรงนี้รวมกรณี `mdReady: false` ด้วย (มาทาง `200` แต่ CLI แปลงเป็น `not_found`
เหมือนกัน ตาม spec 17 § 3.1)

**`not_logged_in` ในสเปกนี้แปลว่า "ผู้ใช้คนนี้ต้อง login ใหม่" ซึ่งกลับด้านจากร่าง
ที่ 2** ที่มันแปลว่า "host ยังไม่ได้ provision" — เพราะตอนนี้ token ที่ใช้เป็นของ
ผู้ใช้จริง ๆ การส่งเขาไป login จึงแก้ปัญหาได้จริง ส่วนความผิดพลาดฝั่ง host ย้ายไป
อยู่ที่ `server` ทั้งหมด **กฎ "ห้ามส่งใครไป login ตอนที่ปัญหาอยู่ที่ host" ยังอยู่
ครบ แค่ย้ายแถว**

exit code ตามเดิม: `0` เมื่อ `ok: true` (รวมถึงผลลัพธ์ 0 รายการ), `1` เมื่อ `ok: false`

### 6.4 ไฟล์ที่แตะ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/core/parseLimit.ts` | **ใหม่** — ย้าย `parseLimit()` ออกจาก `src/commands/memory.ts` (private อยู่ที่ `memory.ts:72`) · 🔴 **ย้ายดื้อ ๆ ไม่ได้**: ตัวเดิมคืน `number \| CallToolResult` ของ memory (ผ่าน `usageFailure()`, `memory.ts:60`) ถ้า `core/` import type จาก `commands/` คือการกลับหัวชั้น → **ลายเซ็นใหม่ `parseLimit(raw, flag, max?): number` ที่ `throw CliUsageError`** และ `memory.ts` ห่อกลับเป็น envelope เดิมของตัวเอง **ข้อความที่ผู้ใช้เห็นห้ามเปลี่ยน** · หมายเหตุ: ตัวเดิม**ไม่มีเพดาน 50** ตรวจแค่จำนวนเต็มบวก เพดาน `≤ 50` ของ spec 17 § 3.1 จึงต้องส่งผ่าน `max` จาก `uploader.ts` |
| `src/index.ts` | ลงทะเบียนคำสั่ง `registerUploaderCommand(program)` — **ขาดไฟล์นี้แปลว่าคำสั่งไม่มีอยู่จริง** และต้องวางให้ถูกตำแหน่งตามคอมเมนต์เรื่องลำดับ `exitOverride()` ที่มีอยู่ ไม่งั้น usage error ของ `--json` จะหลุด envelope ของ T03 |
| `src/core/index.ts` | export `parseLimit` / `uploaderClient` ตาม barrel ที่ใช้อยู่ |
| `package.json` | bump เป็น **`0.5.0`** (ทั้ง `package.json` และ `schema/tools.json` เป็น `0.4.0` อยู่แล้ว — ถ้าไม่ระบุเลขเป้าหมาย ticket จะกลายเป็น no-op) |
| `src/core/uploaderClient.ts` | **ใหม่** — ยิง auth-center, timeout, ไม่ retry 5xx (§ 5.5), แปลง HTTP status → `code`/`hint` |
| `src/commands/uploader.ts` | **ใหม่** — `search` / `fetch` + validation ทั้งหมดของ spec 17 § 3.1 |
| `schema/tools.json` | +2 tool (ไม่ใช่ 3 — ไม่มี login) · version ต้องตรงกับ `package.json` (CI บังคับ) |
| `tickets/T02-memory-outcome-classifier.md` | + `fetched` อย่างเดียว (**ไม่มี `logged_in`** ต่างจาก spec 17 § 3.3) |
| `.claude/skills/bobby-cli/SKILL.md` **และ** `~/.openclaw/workspace/skills/bobby-cli/SKILL.md` | + หัวข้อ Uploader (กฎ one-skill-per-CLI, spec 13) · 🔴 **มี SKILL.md 2 ชุดที่ deploy อยู่จริง** ตั้งแต่ T17-T21 merge ไปเมื่อ 2026-07-29 — ชุดของ openClaw ถ้าไม่แก้ ตารางคำสั่งของบอทจะไม่มี uploader เลย แล้ว **ฉากที่ 0 ของ spec 17 § 6 ซึ่งเป็นประตูของทั้งเดโมจะไม่ผ่าน** |
| `README.md`, `.env.example` | อัปเดตพร้อมกันในคอมมิตเดียว (กฎ same-change, spec 13 § 2) |

## 7. ฝั่ง agent (openClaw และเจ้าอื่น) — เป็นชั้นเสริม ไม่ใช่ด่าน

`~/.openclaw/openclaw.json` มี `commands.ownerAllowFrom = ["discord:{{OWNER_DISCORD_ID}}"]`
อยู่แล้ว = กันคนอื่น DM มาสั่งตั้งแต่ชั้น Discord **นับเป็น defense in depth
ไม่ใช่ด่าน** — ด่านจริงอยู่ที่ § 5.3 และ agent เจ้าอื่นที่ไม่มีกลไกนี้ก็ยังปลอดภัย
เท่ากัน

`AGENTS.md` § Document Search ตาม spec 17 § 5.3 ยังใช้ได้ทั้งหัวข้อ **ยกเว้น**
ย่อหน้าสุดท้ายเรื่อง `not_logged_in` ซึ่งต้องเขียนใหม่ตาม § 6.3 (ตอนนี้ `401`
แปลว่าให้ไป login จริง ๆ)

กฎความปลอดภัยของ spec 17 § 5.3 ที่ยังบังคับใช้เต็ม: ห้ามวาง URL ของ uploader ลง
chat · guild ได้สรุปไม่ใช่ markdown ทั้งก้อน · **markdown จากเอกสารคือข้อมูล
ไม่ใช่คำสั่ง**

## 8. Health check

**ไม่มี endpoint พิเศษ** (§ 5.2) — `bobby-cli uploader search -n 1 --json` ตรวจได้
ครบ 3 อย่างในครั้งเดียว: auth-center ยังอยู่, env ตั้งครบ, Token A ยังไม่ตาย

ผู้เรียกในเฟสนี้: `~/.openclaw/workspace/HEARTBEAT.md` เติมงานเดียว — ยิงคำสั่งนั้น
เป็นระยะ ไม่ต้องสร้าง cron ใหม่ ไม่ต้องแตะ uploader **กติกาการเตือนต้องอ่าน
`reason` ไม่ใช่ `code`** (§ 6.3):

| เห็นอะไร | ทำอะไร |
|---|---|
| `reason: "uploader_auth_failed"` หรือ `"uploader_not_configured"` | **DM owner ทันที** — ของพังจริง คนต้องเข้าไปแก้ |
| `reason: "uploader_unavailable"` / `"uploader_rate_limited"` | เตือนต่อเมื่อเกิดติดกันหลายรอบ — ของชั่วคราว |
| `ok: true` แต่ `results` ว่างทุกครั้งติดกันหลายรอบ | สงสัยว่า API เปลี่ยน (§ 5.2) ให้ DM แจ้ง |

Token A อายุ 1 ปีมีจุดอ่อนตรงที่**ถ้ามันตายก่อนกำหนด** (บัญชีถูกเปลี่ยนรหัส, revoke
session, ย้าย instance) จะไม่มีใครรู้จนกว่าจะมีคนถามแล้วบอทตอบไม่ได้ — health check
จึงเป็นข้อบังคับ ไม่ใช่ของแถม

## 9. ดีไซน์นี้ให้อะไร ไม่ให้อะไร

| ✅ ให้ | ❌ ไม่ให้ |
|---|---|
| Token A อยู่ที่เดียว ไม่มีสำเนาบน bot host | uploader ยังไม่รู้ว่าใครถาม — audit รายคนอยู่ที่ auth-center เท่านั้น |
| เพิกถอนสิทธิ์รายคนได้ (ปลด role / revoke token) ผลทันที | ไม่มีการจำกัดสิทธิ์ระดับเอกสาร |
| กฎเดียวใช้กับ client ทุกเจ้า เปลี่ยน agent ไม่ต้องแก้กฎ | **แยกไม่ออกว่า token ของ owner ถูกใช้ใน DM หรือในกิลด์** (§ 9 ข้อ 3 ข้างล่าง) |
| | **ไม่แยกตาม tenant** — owner ของ tenant ไหนก็อ่าน corpus เดียวกันทั้งหมด (§ 5.3) |
| uploader ไม่ต้องแก้อะไรเลย | auth-center ล่ม = ค้นเอกสารไม่ได้ (จุดตายใหม่ที่ยอมรับ) |
| ไม่มี password ของระบบไหนบนดิสก์ | ไม่ทนต่อ prompt injection ที่ทำให้ model ยิง HTTP เอง — แต่ตอนนี้ต่อให้ยิงเองก็ยังต้องมี Token B ของ owner |

**ทบทวนดีไซน์ใหม่ทันทีเมื่อข้อใดข้อหนึ่งเป็นจริง:**

1. **เปิดให้ staff ใช้** — ตอนนั้น `roles.includes('owner')` ไม่พอ ต้องมีเกณฑ์
   ละเอียดกว่า role (scope ของ uploader หรือ group)
2. **มีเอกสารที่บางคนห้ามเห็น** — uploader ไม่มีฟิลด์ป้ายความลับเลย จะบังคับที่ไหน
   ก็ต้องเพิ่มฟิลด์ก่อน = ต้องแก้ uploader = ออกนอกข้อจำกัด § 1
3. **เปิดใช้ในกิลด์** — 🔴 ข้อนี้สำคัญ: ด่านฝั่ง server เห็นแค่ "Token B ของ owner"
   มันแยกไม่ออกว่าคำสั่งมาจาก DM ของ owner หรือจากกิลด์ที่ owner เป็นแอดมิน
   คำตอบจะถูกอ่านโดยทุกคนในห้อง จะแยกได้ต้องให้ client ส่ง context มา ซึ่งกลับไป
   เป็นคำกล่าวอ้างของ client อีก **ยอมรับได้เพราะกิลด์อยู่ที่ priority ต่ำ
   (§ 1 ข้อ 5) แต่ต้องตัดสินใจใหม่ก่อนเปิดกิลด์ ห้ามไหลไปเอง**
4. **ต้องตอบว่า "ใครเปิดดูอะไรไปบ้าง"** — ต้องมี audit log ที่ auth-center ซึ่ง
   วันนี้มีแค่ `last_used_at` ต่อ token
5. **บอทต้องเขียนกลับ** — สมมติฐาน "GET เท่านั้น" ของ § 5.6 พังทั้งหมด
6. 🔴 **มี tenant ที่สอง** — วันที่โรงแรมที่สองถูก onboard owner ของเขาจะเห็นเอกสาร
   ของโรงแรมแรกทันทีโดยไม่มีใครแก้โค้ด (§ 5.3) **ข้อนี้ต่างจากข้ออื่นตรงที่มันเกิด
   จากการทำงานปกติของทีมขาย ไม่ใช่จากการตัดสินใจทางเทคนิค** จึงเป็นข้อที่จะไหลผ่าน
   ไปโดยไม่มีใครทบทวนได้ง่ายที่สุด

## 10. ทำไมพลิกกลับมาใช้ auth-center (บันทึกการตัดสินใจ)

ร่างที่ 2 § 9 เขียนไว้ว่า **ไม่ใช้** auth-center ด้วยเหตุผล 4 ข้อ ร่างนี้กลับด้าน
เพราะข้อเท็จจริงเปลี่ยน ไม่ใช่เพราะเปลี่ยนใจ:

| เหตุผลเดิมที่ไม่ใช้ | สถานะวันนี้ |
|---|---|
| "โค้ด `resource: uploader` เป็นการคาดการณ์ ไม่มีผู้ใช้" | ยังจริง — และร่างนี้ก็**ยังไม่ใช้**มัน (§ 11 Q-1) ที่ใช้คือ role กับ token ธรรมดา |
| "ต้องแก้ uploader" | **ไม่จริงอีกต่อไป** — auth-center เป็นฝ่ายเรียก uploader ในฐานะ client ธรรมดา uploader ไม่รู้จัก auth-center เหมือนเดิม ไม่ต้องแก้อะไรสักบรรทัด |
| "เพิ่มจุดตายใหม่" | **ยังจริง และเรายอมรับ** — แลกกับการที่ Token A ไม่ต้องไปอยู่บนเครื่องบอท และตรวจสิทธิ์รายคนได้ |
| "ผู้ใช้มีคนเดียว ประโยชน์ยังไม่มีใครใช้" | **เปลี่ยนแล้ว** — team lead กำหนดให้ตรวจ authorization รายคน (ข้อ 2-3) และห้ามผูกกับ openClaw (§ 1 ข้อ 4) ทั้งสองอย่างบังคับให้ด่านอยู่หลัง HTTP |

**สิ่งที่ยกมาจากร่างที่ 2 โดยไม่เปลี่ยน** (ยังถูกอยู่): ไม่เข้ารหัส env เอง
(§ 4.4 เดิม — บอทรัน unattended คีย์ถอดรหัสจึงต้องอยู่ข้าง ciphertext ค่าที่ได้
เท่ากับสิทธิ์ไฟล์ที่มีอยู่แล้ว) · ไม่เก็บ email+password ของ PocketBase ไว้ที่ไหนเลย ·
วิธีมินต์ Token A ด้วย `impersonate` และวิธีเพิกถอน (§ 4.1 เดิม → ย้ายไปอยู่ใน
ticket U01 และ runbook)

## 11. คำถามที่ยังเปิด — มี default ทุกข้อ ไม่ปล่อยค้าง

| # | คำถาม | default ถ้าไม่มีคำตอบ |
|---|---|---|
| Q-1 | ควรบังคับให้ Token B เป็น `resource: "uploader"` ไหม | **ไม่ ในเฟสนี้** — จะบังคับแปลว่า client ต้องถือ token 2 ใบ ซึ่งเป็นความซับซ้อนที่ยังไม่มีใครได้ประโยชน์ ผลที่ยอมรับ: revoke สิทธิ์ uploader = revoke สิทธิ์ความจำไปด้วย · ถ้าเปลี่ยนใจ ต้องทำ 3 อย่างพร้อมกัน: proxy ตรวจ `resource`, `auth login` มินต์เพิ่ม 1 ใบ (`POST /auth/tokens` รองรับอยู่แล้ว `app.ts:801`, `revokeExisting: false` จึงไม่ฆ่าใบเดิม), และจำกัดการมินต์ `resource: "uploader"` ไว้ที่ owner |
| Q-2 | เพิ่ม `roles` ลง response ของ `/auth/tokens/introspect` ด้วยไหม | **ไม่ ในสเปกนี้** — proxy อ่าน DB เองอยู่แล้ว การเพิ่มฟิลด์กระทบ session-memory ที่เป็นผู้บริโภคปัจจุบัน เปิดเป็นงานแยกถ้ามี resource server ตัวที่ 2 ที่ต้องรู้ role |
| Q-3 | `impersonate` รับฟิลด์ `duration` จริงไหม | **เรื่อง header ปิดแล้ว: OpenAPI ประกาศ `Authorization` เป็น header required ทุก path พร้อม `example: "Bearer <token>"`** (ตรวจซ้ำ 2026-08-17 — ฉบับก่อนของสเปกนี้เขียนว่า "ไม่บอกรูปแบบ" ซึ่งผิด) → ใช้ `Bearer ` นำหน้าเป็นค่าเริ่มต้น · ยังคงคำสั่ง "ลองแบบเปล่าเป็น fallback ใน U01" ไว้ เพราะ PocketBase ก่อน v0.23 รับ token เปล่า และ example ใน OpenAPI ไม่ใช่ข้อผูกมัด · ส่วน `duration` ยังต้องยิงจริง ถ้า `impersonate` ใช้ไม่ได้ ใช้ token ธรรมดา + เปลี่ยนมือทุก ~14 วัน โครงสร้างไม่เปลี่ยน — health check (§ 8) จึงต้องมีตั้งแต่แรก |
| Q-4 | `/api/ai/search-files` มี rate limit ของตัวเองไหม | ถือว่ามี — เราจำกัดฝั่งเราที่ 30 req/5 นาที (§ 5.4) และ agent จำกัด 1 `search` + 1 `fetch` ต่อ turn (spec 17 § 5.3) |
| Q-5 | บัญชีบอทบน PocketBase ตั้งเป็น read-only ได้ไหม | ถ้าไม่ได้ ก็ใช้บัญชีปกติ + กฎ § 5.6 (ไม่มีเส้นทาง non-GET ในโค้ด) |
| Q-6 | `-n` เพดาน 50 หรือ 500 (brief กับ OpenAPI ไม่ตรงกัน — OpenAPI ประกาศ `maximum: 500`, `default: 10` ยืนยัน 2026-08-17) | **คงเพดานที่ 50 ทั้งสองฝั่ง** ไม่ว่าปลายทางจะรับได้เท่าไร — คำตอบที่ agent อ่านไหวมีไม่ถึง 50 อยู่แล้ว และเราไม่ควรเป็นคนสร้างภาระ 500 รายการให้ระบบของคนอื่น · ถ้าจะผ่อนต้องแก้ทั้ง § 5.2 และ spec 17 § 3.1 พร้อมกัน |
| Q-7 | `GET /api/files/{id}` รับ `pb_record_id` หรือ `id` ของ `AIFileResult` | ยิงจริงด้วยทั้งสองค่าใน A-2 แล้วบันทึกคำตอบลง § 5.2 · ค่าเริ่มต้น: `pb_record_id` แล้ว fallback `id` |

## 12. ความเสี่ยงที่ต้องรู้ก่อนลงมือ

| # | เรื่อง | ต้องทำอะไร |
|---|---|---|
| R-1 | 🔴 **auth-center มีซาก uploader ค้างอยู่มากกว่าที่คิด ไม่ใช่แค่ template เดียว** — `ui.tsx:1447` (URL), `:1467-1483` (template `mcp-remote` ที่**ผิดกับความจริง** เพราะ uploader เป็น PocketBase REST ไม่ใช่ MCP), ปุ่มสลับ service "Uploader", `:1443-1444` (`hasActiveTokenByResource(user.id,'uploader')`), **`:1385` `POST /ui/session-memory/uploader-tokens` ที่มินต์ token `resource:'uploader'` ให้ user ที่ล็อกอินคนไหนก็ได้ โดยไม่ตรวจ role เลย และหน้าเว็บก็ไม่มีฟอร์มเรียกมันแล้ว = endpoint กำพร้าที่ยังเรียกได้**, `:1416` (delete route คู่กัน) | ตั้ง `UPLOADER_URL` เป็นค่าจริงเมื่อไหร่ template จะเริ่มโฆษณาสิ่งที่ใช้ไม่ได้ → **A-5 ต้องเก็บซากทั้ง 6 จุด ไม่ใช่แค่ template** ไม่งั้นจะเหลือ endpoint ที่ staff มินต์ token ซึ่ง § 5.3 ปฏิเสธอยู่ดี = เครื่องผลิต support ticket |
| R-2 | token ใน D1 เก็บเป็น **plaintext** (`auth.ts:244` `WHERE token = ?`) | เป็นสภาพเดิมของระบบ ไม่ใช่สิ่งที่ spec นี้สร้าง — ไม่แก้ในรอบนี้ แต่บันทึกไว้เพราะ proxy เพิ่มผู้บริโภคของ token ใบเดิมอีกราย |
| R-3 | ผู้ใช้ทุกคนใน tenant ที่มี role `owner` ผ่านด่านหมด ไม่ใช่แค่ owner คนที่ team lead คิดถึง | ตรวจรายชื่อด้วย `GET /auth/users` ก่อนเปิดใช้ ถ้ามี owner หลายคนโดยไม่ตั้งใจ ให้แก้ role ก่อน ไม่ใช่แก้โค้ด |
| R-4 | production deploy ของ auth-center **ทำจากเครื่อง macOS นี้ไม่ได้** (`CLAUDE.md`) | ทำและพิสูจน์บน dev/test ให้ครบก่อน แล้วส่ง runbook ให้ team lead ไป deploy production |
| R-5 | 🔴 **uploader มีตัวเดียว แต่ auth-center มี 2 ตัว** — dev/test กับ production จะชี้ไปที่เดียวกัน แปลว่า (ก) การทดสอบจากเครื่องนี้ยิงใส่**ข้อมูลจริง**และ rate limit จริงที่ n8n ของ dev ใช้อยู่ (ข) ถ้าใช้ Token A ใบเดียวกัน การเพิกถอนตอน dev/test รั่วจะ**ทำ production ตายไปด้วย** | ✅ **เคาะแล้ว 2026-08-18: ขอ 2 ใบ** คนละใบสำหรับ dev/test กับ production เป็นส่วนหนึ่งของ U01 · ถ้า dev ยืนยันว่าออกได้ใบเดียวจริง ๆ ให้กลับมาถามเจ้าของก่อน แล้วบันทึกในรันบุ๊กว่าการ rotate กระทบทั้งสอง environment และต้องนัดเวลา |
| R-6 | ยังไม่เคยมีใครยิง uploader ด้วย credential จริงเลย — ทุกอย่างในสเปกนี้ยืนยันได้แค่ระดับ contract (OpenAPI + รหัสสถานะ) | U01 ต้องจบก่อน A-1 จะปิดได้ · ข้อที่ต้องพิสูจน์ตอนยิงจริงถูกรวมไว้ที่ Q-3, Q-6, Q-7 แล้ว ไม่มีข้อไหนถูกปล่อยเป็นสมมติฐานเงียบ ๆ |
| R-7 | **หมุน `UPLOADER_TOKEN` ไม่ได้แบบไม่มี downtime** — มี env ช่องเดียว การเปลี่ยนคือการตัดสวิตช์ ระหว่างที่ deploy ยังไม่จบ ทุกคำสั่งจะได้ `502 uploader_auth_failed` | ยอมรับได้เพราะผู้ใช้มีคนเดียวและ downtime สั้น · เขียนขั้นตอน (ขอ token ใหม่ → `wrangler secret put` → ยิง `search -n 1` ยืนยัน) ลงรันบุ๊กของ A-5 และแจ้ง owner ก่อนทำ |

## 13. Tickets

ฝั่ง auth-center กับ bobby-cli เดินขนานกันได้หลัง A-1 กำหนด contract แล้ว
**U01 ไม่ได้บล็อกการเริ่มเขียนโค้ด แต่บล็อกการปิด A-1/A-2** — ทั้งสอง ticket ปิดไม่ได้
จนกว่าจะยิง uploader จริงสำเร็จ (R-6)

| Ticket | repo | ขึ้นกับ | ขอบเขต |
|---|---|---|---|
| **U01** | — | — | ขอ **บัญชีบอทของ PocketBase** (ไม่ใช่บัญชีของคน) + **Token A 2 ใบ — คนละใบสำหรับ dev/test กับ production** (เจ้าของเคาะ 2026-08-18, R-5) · ยืนยัน Q-3 · เขียนวิธีเพิกถอน (revoke session ของบัญชีนั้น → token ทุกใบตายทันที) ลง `docs/runbooks/` |
| **A-1** | auth-center | (U01 เพื่อปิด) | `interface Env` + `UPLOADER_TOKEN` · helper `requireOwnerToken` (§ 5.3) · `GET /uploader/search` (§ 5.2) พร้อม allowlist ของ query param · การแปลง error ทั้งตาราง § 5.5 · rate limit § 5.4 |
| **A-2** | auth-center | A-1, **U01** | `GET /uploader/fetch?id=` แบบ 2 ขั้น (record → markdown) ใต้ `AbortSignal` ตัวเดียว (§ 5.5) · `mdReady: false` เมื่อไม่มี `md_file_url` · **ไม่รับ URL · off-origin = ไม่ดึงเลย** · ปิด Q-7 ด้วยการยิงจริงทั้ง `pb_record_id` และ `id` · **แก้ `app.ts` ไฟล์เดียวกับ A-1 → ทำต่อจาก A-1 ห้ามขนาน** |
| **A-4** | auth-center | A-1, A-2 | test ใน `test/app.test.js` (`npm test` = `tsx --test`): ไม่มี token → 401 · token ถูก revoke/หมดอายุ → 401 · staff → 403 · machine token → 403 · banned owner → 401 · owner → 200 · env ไม่ครบ → 503 · `http://` ใน `UPLOADER_URL` → 503 · **uploader ตอบ 401 → ต้องได้ 502 ไม่ใช่ 401** · **uploader ตอบ 404 → ต้องได้ 404 ไม่ใช่ 502** · `limit=999` → clamp เป็น 50 ไม่ใช่ 400 · `md_file_url` ข้าม origin → **ไม่มี request ออกไปเลย** · `404` บนขา search → `502` ไม่ใช่ `404` · body `200` ที่ไม่มี `results` array → `502` · `UPLOADER_TOKEN` ไม่โผล่ใน response ใด ๆ · ไม่มี request non-GET ออกไปหา uploader |
| **A-5** | auth-center | A-4 | **เก็บซาก uploader ใน `ui.tsx` ทั้ง 6 จุดตาม R-1** (ไม่ใช่แค่ template — รวมถึง `POST /ui/session-memory/uploader-tokens` ที่เป็น endpoint กำพร้าไม่ตรวจ role) · `wrangler.example.toml` + `.dev.vars.example` · deploy dev/test + `wrangler secret put UPLOADER_TOKEN` · **รันบุ๊กที่มีขั้นตอน rollback** (route เป็นการเพิ่มล้วน ๆ — ถอนได้ด้วยการ deploy คอมมิตก่อนหน้า และการลบ secret ทำให้ทุก route ตอบ 503 โดยไม่กระทบ session-memory) · runbook สำหรับ team lead ไป deploy production |
| **U02** | bobby-cli | A-1 | `src/core/parseLimit.ts` ลายเซ็นใหม่ตาม § 6.4 (memory ห่อกลับให้ข้อความเดิม) + `src/core/uploaderClient.ts`: base URL จาก `resolveAuthCenterUrl(creds.authCenterUrl)` (§ 6.1), timeout 45 วิ, **ไม่ retry 5xx** · 🔴 **เพิ่ม context `"uploader"` ให้ `classifyAuthCenterFailure` (`classifyFailure.ts:50`) ห้ามใช้ `"other"` ซ้ำ** (§ 6.3) · ส่ง `reason` ผ่านขึ้น envelope |
| **U03** | bobby-cli | U02 | **สร้าง `src/commands/uploader.ts` + ลงทะเบียนใน `src/index.ts`** (U04 ต่อยอดไฟล์เดียวกัน → ห้ามทำขนานกับ U04) · `uploader search` ตาม spec 17 § 3.1 ครบทุกข้อ (validation ก่อนออกเน็ตทั้งหมด, filter-first retry, `text` แบบชื่อไฟล์ — คำอธิบาย, ไม่มี score) |
| **U04** | bobby-cli | **U03** | `uploader fetch <id>` · `--max-chars` ตัดที่ท้ายบรรทัด · `mdReady: false` → `not_found` exit 0 |
| **U05** | bobby-cli | U03, U04 | test ใหม่ `test/uploaderClient.test.ts` ตามแบบ `test/mcpClient.test.ts`: ทุกแถวของตาราง § 6.3 แปลงเป็น `code`/exit ถูกต้อง · ไม่มี retry เมื่อได้ 5xx · `--profile` ที่ไม่มี credential → `not_logged_in` ก่อนออกเน็ต · เพิ่มเคส uploader ใน `test/commandEnvelope.test.ts` |
| **U06** | bobby-cli | U05 | `schema/tools.json` (2 tool + แก้ `$comment` ให้รวม `uploader.ts`) · `tickets/T02` เพิ่ม `fetched` · `.env.example` · `README.md` · **SKILL.md ทั้ง 2 ชุด** (repo นี้ + `~/.openclaw/workspace/skills/`) · bump เป็น **0.5.0** — **คอมมิตเดียวกันทั้งหมด** (กฎ same-change + CI บังคับ version ตรงกัน) |
| **U07** | `~/.openclaw/workspace` | U06, A-5 | `AGENTS.md` § Document Search ตาม spec 17 § 5.3 (ตัด provisioning ออก, เขียนย่อหน้า `not_logged_in` ใหม่ตาม § 6.3) · ไม่ต้องตั้ง env ใด ๆ บน host |
| **U08** | — | U07 | `HEARTBEAT.md` + health check (§ 8) · รัน 5 ฉากของ spec 17 § 6 ใน **DM** · **วัดเวลาฉากที่ 3 เทียบกับ turn timeout จริงของ agent** (spec 17 V-6 — งบเวลาใน § 5.5 บอกว่า worst case ~90 วิ) · ปิด V-1…V-5 ที่ค้างจาก spec 17 |

## 14. Done when

1. `bobby-cli uploader search --document-type reservation_list -n 5 --json`
   คืน `ok: true` โดย**บนเครื่องที่รันไม่มี env ของ uploader แม้แต่ตัวเดียว** และ
   ไม่มี credential ของ PocketBase อยู่ที่ไหนเลย
2. บัญชีที่ role เป็น `staff` รันคำสั่งเดียวกัน → `permission_denied` และ hint
   **ไม่ชวนไป login**
3. ปลด role `owner` ของบัญชีหนึ่ง → คำสั่งถัดไปของบัญชีนั้นถูกปฏิเสธทันที
   **โดยไม่ต้อง login ใหม่และไม่ต้อง restart อะไร**
4. `curl` ตรงไปที่ `/uploader/search` โดยไม่มี header → `401` · ด้วย token ของ
   machine → `403` · ด้วย `limit=999` (ข้าม validation ของ CLI) → **สำเร็จโดย
   ถูก clamp เป็น 50** ไม่ใช่ยิง 999 ต่อไปให้ uploader
5. ตั้ง `UPLOADER_TOKEN` ให้ผิดชั่วคราว → bobby-cli ได้ `code: "server"` ที่ hint
   บอกให้ติดต่อผู้ดูแล **ไม่ใช่ `not_logged_in` และไม่ชวนใครไป login**
5.1. `uploader fetch <id ที่ไม่มีอยู่จริง>` → `code: "not_found"` **exit 0** ไม่ใช่
   `server` — พิสูจน์ว่า `404` ของ uploader ไม่ถูกกลืนเป็น `502`
5.2. ตั้ง `UPLOADER_URL` เป็น `http://…` → ทุก route ตอบ `503` ไม่มี request ใด
   ออกจาก Worker
6. ไม่มี Token A โผล่ใน output ช่องทางไหนเลย รวมถึงตอน error และใน log ของ Worker
7. ไม่มี request non-`GET` ออกจาก auth-center ไปยัง `UPLOADER_URL` ในทุกเส้นทางโค้ด
8. `HEARTBEAT.md` จับได้จริงเมื่อ Token A ตาย — ทดสอบด้วยข้อ 5
9. ทั้ง 5 ฉากของ spec 17 § 6 ผ่านใน DM ของ owner
10. `schema/tools.json` version ตรงกับ `package.json` (CI บังคับ) และ `tickets/T02`
    มี `fetched`
