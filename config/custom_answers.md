# Custom Answers — owner-taught Q&A

Mohammad edits this file to teach the bot specific Q&A pairs. Every entry is
loaded into the bot's system prompt with HIGHEST priority — if the customer's
question matches one of these patterns, the bot should answer exactly as written.

---

## Format

Each block is one teachable pair:

```
### Q: <how the customer is likely to phrase the question>
### A: <the exact answer the bot should give>
```

Write several "Q:" lines for the same "A:" when customers phrase the same
question different ways — one entry per phrasing is fine.

---

## Examples (delete once you add real ones)

### Q: do you deliver to Abu Dhabi?
### A: Yes — we deliver across the UAE including Abu Dhabi. Orders placed before 6 PM reach Dubai the same day; Abu Dhabi and other emirates arrive within 1–3 business days.

### Q: do you buy old phones?
### Q: can you buy my iphone?
### Q: want to sell my phone to you
### A: Unfortunately we don't buy devices from customers — we only sell. For trade-in options, please check Apple's official trade-in program.

### Q: do you deliver internationally?
### Q: can you ship to Saudi Arabia?
### A: Currently we only deliver within the UAE. For international orders please contact our team.

---

## How to add a new answer

1. Add a new `### Q: ...` / `### A: ...` block here.
2. Save the file.
3. Restart the server: `./stop.sh && ./start.sh`.
4. The next customer asking that kind of question gets the exact answer above.

## Tips
- Keep answers short, friendly, factual.
- Don't duplicate info that's already in policies.md / payment_methods.md.
- Use this file for edge cases and owner-specific phrasing.
