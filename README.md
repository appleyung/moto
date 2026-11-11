# EPC_V30_2 (optional-modules)

## Layout
```
index.html
style.css
app.js
i18n/
  transfer-eng.js
  transfer-jp.js
  transfer-id.js
  transfer-th.js
parsers/
  yamaha.js
  honda-jp.js
  honda-id.js
  kawasaki-id.js
  kawasaki-th.js
```

## Optional modules
Any single parsers/*.js or i18n/*.js can be deleted/missing.
- App still loads and runs (PDF view, zoom, PickList UI).
- Missing brand → that manual type has weak/no part parse; others unchanged.
- kawasaki-id.js and kawasaki-th.js are FULL independent copies (similar size is expected).

## Serve with Live Server (not file://).
