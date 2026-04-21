# alAsil Shop Policies (for AI agent context)

This file is used by the AI agent to answer customer FAQ questions.
Edit this file to add or correct policy details. Restart the server after editing.

---

## Store info
- Name: alAsil — 100% Authentic Apple Store
- Website: https://www.alasil.ae/
- Customer portal (for returns): https://portal.alasil.ae
- Phone: +971 4 288 5680 / +971 4 577 5943
- WhatsApp: +971 4 288 5680
- Address: 509 Gargash Center, Al Sabkha Rd, Deira, Dubai, UAE
- Hours: Monday to Saturday, 10:00 AM – 9:00 PM
- Closed: Sundays and UAE public holidays

## Products
- 100% authentic Apple products (iPhone, iPad, Mac, Apple Watch, AirPods, Vision Pro, accessories)
- Also: Dyson, select home electronics
- Every product comes with 1-Year Official Apple Warranty

## Shipping & Delivery
- Free delivery across the UAE
- Same-Day Delivery in Dubai if order is placed before 6 PM
- 1-3 business days for delivery outside Dubai

## Payment Methods (summary — see payment_methods.md for full details)
- **Cash on Delivery** — available **only for orders under AED 1,500**. Shown at checkout for eligible addresses. Pay cash to courier on delivery. No surcharge. Inspect before paying. For carts ≥ AED 1,500, customer must use card / Apple Pay / Tabby / Tamara.
- **Credit/Debit cards** — Visa, Mastercard, American Express (Diners, Discover, JCB also accepted). Secured with 3D Secure.
- **Digital wallets** — Apple Pay, Google Pay. Samsung Pay.
- **Tabby** — 4 interest-free installments.
- **Tamara** — 4 installments, Sharia-compliant, no late fees.
- **Bank transfer** — bulk/corporate orders only (contact the team).

### What we DON'T offer — don't promise these
- 6-month / 12-month / 24-month installment plans
- Bank-promo plans (ADCB, Emirates NBD, FAB, etc.)
- Postpay, Cashew, Spotii, Samsung Pay

If a customer asks for a plan longer than 4 payments, tell them we only have Tabby/Tamara (4 payments each) and suggest they check their issuing bank's own installment program.

## Order Tracking — "Where is my order?" / "When will it arrive?"
When a customer asks about an order's location / ETA / status, the bot should:
1. Direct them to the **tracking link** we send via **email** and **WhatsApp** when the order is dispatched.
2. Ask them to check the **spam / junk folder** if they don't see the email.
3. Do NOT ask for the order number. Do NOT promise to resend. Just give the tracking-link guidance.

Canonical response (EN):
> Your tracking link is sent by email and WhatsApp as soon as your order is dispatched.
> Please check your inbox — if you don't see it, try the spam or junk folder.

Canonical response (AR):
> تم إرسال رابط التتبع إلى بريدك الإلكتروني وواتساب فور شحن الطلب.
> يرجى مراجعة صندوق الوارد — إذا لم تجده، تحقق من مجلد الرسائل غير المرغوب فيها (Spam).

## Versions (iPhone + MacBook) — top customer question (3% of all chats)

**IMPORTANT terminology:** "UAE version" and "Middle East version" are the **same thing**. Don't treat them as separate.

### iPhone — Middle East version vs International version
- **Middle East version:** sold on the UAE official channel. **FaceTime disabled** (UAE regulation).
- **International version:** sourced internationally. **FaceTime ENABLED**. Product title explicitly shows "With FaceTime".
- Both carry the full Apple 1-year warranty.
- The product title tells you which version you're getting.

### iPhone — SIM capability by generation
- **iPhone 15 / 16 / 17 / Air:** **Dual eSIM only** (no physical SIM slot).
- **iPhone 14 and older:** **nano-SIM + eSIM** (dual SIM).
- Same SIM setup for both Middle East and International versions.

### MacBook — how to tell the version
MacBooks don't use FaceTime as the differentiator. Use the **keyboard layout** in the product title:
- Title says **"English Keyboard"** (or keyboard info is absent) → **International version**.
- Title says **"Arabic Keyboard"** (or "English/Arabic Keyboard") → **Middle East version**.

Stock reality: most MacBooks in our catalog are the International version (English keyboard). Arabic-layout units are rarer — tell the customer we'll confirm stock if they specifically need one.

### Canonical answers

"Is it UAE version?" / "Middle East version?":
> Yes — we carry both the **Middle East version** and the **International version** (these are the same two options, "UAE" and "Middle East" mean the same thing).
> The product title tells you which one you're ordering. Both come with a full Apple 1-year warranty.

"Does iPhone have FaceTime?":
> FaceTime depends on the version. **International version** models have FaceTime enabled; **Middle East version** models don't (UAE regulation).
> The product title shows which one — International models say "With FaceTime".

"Dual eSIM or physical SIM?":
> iPhone 15 / 16 / 17 / Air → **Dual eSIM only**, no physical SIM slot.
> iPhone 14 and older → **nano-SIM + eSIM**.
> Same for both Middle East and International versions.

"Is this MacBook UAE version?":
> For MacBook, the version is determined by the **keyboard layout** shown in the title:
> - **English Keyboard** (or title doesn't specify) → International version.
> - **Arabic Keyboard** → Middle East version.
> Both come with the full Apple 1-year warranty.

## Warranty
- 1-Year Official Apple Warranty on all products
- Products are sourced through authorized channels
- Warranty claims can be made at any authorized Apple service center in UAE
- [ADD: specific warranty claim process if needed]

## Returns & Refunds
- Submit return request via Customer Portal: https://portal.alasil.ae
- DO NOT ship items back without prior authorization
- For defective, damaged, or wrong items — contact immediately
- After inspection, refund is issued to the original payment method
- Refund processing time: within 10 business days (bank may need additional time)
- [ADD: return window in days — usually 14 or 30]
- [ADD: conditions for returnable items — unopened packaging, etc.]
- [ADD: non-returnable items if any — gift cards, opened sealed products, etc.]

## Tabby & Tamara (BNPL)
- Select at checkout
- Tabby: 4 interest-free installments
- Tamara: Sharia-compliant installments, no late fees
- [ADD: minimum purchase amount for Tabby/Tamara if any]
- [ADD: maximum purchase amount for Tabby/Tamara if any]

## Authenticity
- Every product sold is 100% genuine Apple
- Sourced through authorized channels
- Full Apple warranty applies
- Customers can verify authenticity via serial number on Apple's official website

## Off-topic questions the bot should NEVER answer
- Tech support / device setup / troubleshooting — refer to Apple Support
- Repairs on devices bought elsewhere
- Other brands (Samsung, Huawei, Windows laptops, etc.)
- General coding, cooking, politics, etc.
- Jailbreak, unlock, firmware modifications
- For all of the above, reply: "I can only help with alAsil shopping questions.
 For tech support, please contact Apple Support. For other topics, please call us."
