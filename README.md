# Maa Brahmani Gas Agency | Go Gas — Online Booking

Web app for **Maa Brahmani Gas Agency | Go Gas**, Jobat, MP.

## Features

- 🛢️ Online LPG cylinder booking (14.2 kg, 19 kg, 5 kg)
- 🇮🇳 **Hindi / English** language toggle
- 🎤 **Voice input** — speak to fill name, phone, address & notes (Hindi/English)
- 📱 **UPI payment** with QR code + deep link
- 💵 Cash on Delivery option
- 🧾 Auto-generated **GST Tax Invoice PDF** (matches business format)
- 📲 **WhatsApp** bill + PDF link delivery
- 📩 **SMS alerts** (Twilio or MSG91)
- 👨‍💼 Admin panel — confirm UPI payments, **update pricing/GST**, **manage coupons**, view orders

## Quick Start (Local)

```bash
cd lpg-booking-app
cp .env.example .env
# Edit .env — set UPI_ID and BUSINESS_PHONE
npm install
npm start
```

- **Booking:** http://localhost:3456
- **Admin:** http://localhost:3456/admin.html

## UPI Setup

Add to `.env`:

```
UPI_ID=yourbusiness@paytm
UPI_PAYEE_NAME=Maa Brahmani Gas Agency
```

Customer flow:
1. Select **UPI payment** → place order
2. Scan QR or tap **Pay via UPI**
3. Tap **I Have Paid** → admin gets SMS alert
4. Admin confirms payment → customer gets bill on WhatsApp/SMS

## SMS Setup

**Twilio:**
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_SMS_FROM=+1...
```

**MSG91 (India):**
```
MSG91_AUTH_KEY=...
MSG91_SENDER_ID=MBGAS
```

## Deploy to Render (Free)

1. Push this folder to GitHub
2. Go to [render.com](https://render.com) → **New Blueprint**
3. Connect repo — Render reads `render.yaml` automatically
4. Set env vars: `UPI_ID`, `BUSINESS_PHONE`, `ADMIN_KEY`
5. Deploy → your app URL: `https://maa-brahmani-lpg-booking.onrender.com`

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select repo → Railway uses `Dockerfile` + `railway.toml`
4. Add environment variables in Railway dashboard
5. Generate public domain in **Settings → Networking**

## Docker

```bash
docker build -t maa-brahmani-lpg .
docker run -p 3456:3456 -e UPI_ID=your@paytm -e ADMIN_KEY=secret maa-brahmani-lpg
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UPI_ID` | For UPI | Business UPI VPA |
| `BUSINESS_PHONE` | Yes | Agency phone (SMS alerts) |
| `ADMIN_KEY` | Yes | Admin panel password |
| `TWILIO_*` | Optional | WhatsApp + SMS via Twilio |
| `MSG91_*` | Optional | SMS via MSG91 |

## Admin Features

### Orders, Customers & Reports
All orders and customers are stored permanently in **SQLite** (`data/booking.db`).

**Admin panel tabs:**
- **Orders** — search, view, download PDF, export CSV
- **Customers** — all registered customers with consumer number, order count, total spent, full order history
- **Reports** — revenue, GST, cylinder sales, monthly breakdown, top customers
- **Export for accounting** — Orders CSV, Customers CSV, Accounting CSV (confirmed orders with CGST/SGST split)

Set `DATABASE_PATH` in `.env` for production (use a persistent disk path on Render/Railway).

### Pricing (Admin → Pricing tab)
Update cylinder **price**, **GST %**, **delivery charge**, and **delivery GST** — saved to `data/pricing.json`.

### Coupons (Admin → Coupons tab)
Create discount coupons:
- **Flat** (e.g. ₹50 off) or **Percent** (e.g. 10% off, max cap)
- Min order amount, expiry date, usage limit
- Enable/disable or delete coupons

Sample coupons: `GOGAS50` (₹50 off), `WELCOME10` (10% off)

Customers apply coupons at checkout — discount shown on bill and invoice.

## GST PDF Invoice

Every order generates a **Tax Invoice PDF** matching the Maa Brahmani Gas Agency format:
- Business header, GSTIN, customer details
- Line items with SAC codes, CGST/SGST split
- Bank transfer details, terms & grand total

**Download:** `/api/orders/{invoiceNumber}/pdf`

PDF link is sent via **WhatsApp/SMS** after order. Set `BASE_URL` to your public URL (required for WhatsApp PDF attachment in production).

## Update Prices (manual)

Edit `data/pricing.json` or use the Admin Pricing tab.
