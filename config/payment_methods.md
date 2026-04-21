# alAsil — Payment Methods Reference (for AI / FAQ answers)

**Source:** alasil.ae/pages/faq, /policies/terms-of-service, homepage + cart footer icons (verified 2026-04-19).
**Use this file as the authoritative answer source for any payment/BNPL/COD question.** Do not invent plans that aren't listed here.

---

## 1. Credit / Debit Cards

**Accepted cards:** Visa, Mastercard, American Express (plus Diners Club, Discover, JCB shown in footer).
**Security:** SSL encryption + 3D Secure authentication at checkout.
**Fees:** none — surcharges are not applied to card payments.

## 2. Digital Wallets

- **Apple Pay** — supported, select at checkout.
- **Google Pay** — supported (icon in cart + footer).
- **Samsung Pay** — not supported.

## 3. Buy Now, Pay Later (BNPL)

### PDP banner (shown on every product page)
Customers see on each product page:
> **Shop Now, Pay Later!**
> You can choose **Tabby** or **Tamara** at checkout.

### Tabby (verified from tabby.ai/en-AE, 2026-04-18)

Tabby runs **multiple tiers** at checkout, shown based on customer + basket eligibility:

| Plan | How it splits | Interest / Fees |
|---------------|----------------------------------------|-------------------------------------------|
| **Pay in 4** | 4 equal monthly payments (25% today) | **0% interest, no fees** when paid on time |
| **Pay Monthly — 3 months** | 3 equal monthly payments | **0% interest, no service fee** |
| **Pay Monthly — 6 months** | 6 equal monthly payments | **0% interest, but a service fee** is added (shown at Tabby's checkout step) |
| **Pay Monthly — 12 months** | 12 equal monthly payments | **0% interest, larger service fee** (shown at Tabby's step) |

**alAsil's PDP widget itself advertises "Split in 4"** (`installmentsCount: 4` is hard-coded on product pages), so the 4-payment tier is always visible. **Longer 3/6/12-month Pay Monthly tiers become visible at Tabby's OWN checkout step**, not on alAsil's page, and only if Tabby pre-approves the customer for them.

**Late fees (UAE, real):** AED 15 on missed due date · +AED 30 after 2 weeks · +AED 60 after 4 weeks. Further Tabby purchases blocked until settled. Source: tabbyhelp.freshdesk.com

### Tamara (verified from tamara.co/en-ae, 2026-04-18)

| Plan | How it splits | Interest / Fees |
|-------------------------------|-----------------------------------------|---------------------------------------|
| **Pay in 3** | 1 today + 2 more over 60 days | **0% interest, no fees** |
| **Pay in 4** | 4 equal payments (25% today) | **0% interest, no fees** |
| **Pay Next Month / Pay Later**| Single payment, deferred up to ~30 days| **0% interest** |
| **Pay in 6** (monthly) | 6 monthly payments — available at participating UAE retailers | **0% interest, no fees** (Sharia model) |

**Pay in 12 is NOT available to UAE retail customers** as of today (it's a KSA-only tier).

**Late fees:** **None** — verbatim from Tamara FAQ: *"If you do miss a payment, no late fees will be charged whatsoever."* But missed payments can suspend the account and are reported to AECB (Al Etihad Credit Bureau).

**Sharia:** 100% Sharia-compliant (Sharia Review Bureau certified). Regulated by Central Bank of the UAE.

### What alAsil itself does NOT offer directly
- No alAsil bank-promo plan (ADCB, Emirates NBD, FAB, Mashreq, CBD, Dubai First, HSBC, RAKBANK).
- No alAsil-branded "6-month" or "12-month" plan. Those tiers exist **only through Tabby or Tamara** and only for customers they pre-approve.
- Postpay, Cashew, Spotii, Samsung Pay — not supported.

### Canonical answer if customer asks about 6-month / longer plans
> "Yes — both **Tabby** and **Tamara** have longer monthly plans in the UAE.
> • **Tabby** offers Pay in 4, or Pay Monthly over 3 / 6 / 12 months. 3 months has no fee; 6 and 12 months add a service fee that Tabby shows you at their step.
> • **Tamara** offers Pay in 3, Pay in 4, and **Pay in 6** (available at participating retailers) — all interest-free with no late fees.
>
> You'll only see the tiers you're pre-approved for at checkout. For anything longer or for a bank-specific plan, please contact your card's issuing bank."

## 4. Cash on Delivery (COD)

### Operational rules (authoritative — not disclosed on public site)
- **Maximum order amount for COD: AED 1,500.**
  - Orders at AED 1,500 or above CANNOT use Cash on Delivery.
  - Above this threshold, the customer must use: Credit/Debit card, Apple Pay, Google Pay, Tabby, or Tamara.
- Availability: shown at checkout for eligible addresses. Checkout won't offer COD if the cart is at/above the AED 1,500 limit.

### Public-site wording (what customers see)

- **Availability:** decided at checkout based on delivery address AND cart total (must be under AED 1,500).
- **How it works:**
  1. Place the order and choose Cash on Delivery at checkout (only visible if cart < AED 1,500).
  2. No upfront payment — pay the courier in cash when the package arrives.
  3. You can inspect the package on delivery before paying.
- **Fees / surcharge:** none disclosed on the site.

## 5. Bank Transfer (Wire)

- Available **for bulk and corporate orders only** — not the default retail option.
- To arrange, contact sales: **+971 4 288 5680** or **return@alasil.ae**.

## 6. Refunds (which payment → which method back)

- Refunds are always issued to the **original payment method**.
- Processing time: within **10 business days** after approved return is received and inspected. Bank clearing may add a few days.
- Return requests go through the portal: **https://portal.alasil.ae**.

---

## FAQ shortcuts — exact answers the bot should be able to give

| Question | Short, correct answer |
|-----------------------------------------------|--------------------------------------------------------------------------|
| "Do you have Tabby?" | Yes — 4 interest-free installments. Select at checkout. |
| "Do you have Tamara?" | Yes — 4 installments, Sharia-compliant, no late fees. |
| "Can I pay in 6 months?" | Yes — both **Tabby** (Pay Monthly, 6-month tier has a service fee) and **Tamara** (Pay in 6, interest-free). Visible at checkout if you're pre-approved. |
| "Can I pay in 12 months?" | **Tabby** offers 12-month Pay Monthly with a service fee. **Tamara** does not offer 12 months in the UAE today. |
| "Are there late fees?" | **Tabby:** AED 15 on missed day, +30 after 2w, +60 after 4w. **Tamara:** no late fees (but missed payments suspend account + get reported to AECB). |
| "Is Tabby / Tamara halal?" | Both are certified **Sharia-compliant** (Shariyah Review Bureau). |
| "Do you accept Apple Pay?" | Yes, at checkout. |
| "Do you accept Amex?" | Yes — Visa, Mastercard, Amex (and Diners, Discover, JCB). |
| "Cash on delivery?" | Yes, pay cash when it arrives — shown at checkout for eligible addresses. |
| "Any charge for cash on delivery?" | No COD surcharge disclosed — for large orders, call +971 4 288 5680. |
| "Can I use bank transfer?" | Only for bulk/corporate orders — contact team to arrange. |
| "Do you have installments with [bank name]?" | Only Tabby and Tamara. Bank's own installment programs aren't part of our checkout. |
| "How long to get my refund?" | Within 10 business days to the original payment method. |

---

## Tone notes for the bot
- Be direct about what we DO and DON'T have. Never say "maybe" or "call to check if we have X" for plans we've confirmed don't exist (like 6-month).
- If a customer insists on a 6-month / longer plan, politely suggest speaking to their bank about bank-side installment programs — that's the honest redirect.
- Always keep it short (2–4 lines) and add the relevant emoji ( for cards, / for yes/no, for call-back).
