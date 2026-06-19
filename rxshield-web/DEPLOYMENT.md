# RxShield Edge Deployment & Headers Guide

To run local multi-threaded WebAssembly (SQLite WASM and ONNX Web WASM) in the browser, modern browsers require **Cross-Origin Opener Policy (COOP)** and **Cross-Origin Embedder Policy (COEP)** headers.

Since Next.js static exports (`output: 'export'`) ignore the `headers()` option in `next.config.js`, these headers MUST be configured at your hosting provider layer.

---

## 1. Hosting Configurations

### Vercel (`vercel.json`)
Create a `vercel.json` file in the root of your deployment:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

### Cloudflare Pages (`_headers`)
Create a `_headers` file in your `public/` directory (so it is copied to `out/`):
```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### Netlify (`netlify.toml`)
Create a `netlify.toml` in your root directory:
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

### Nginx (`nginx.conf`)
Add the headers to your server block:
```nginx
server {
    ...
    add_header Cross-Origin-Opener-Policy "same-origin";
    add_header Cross-Origin-Embedder-Policy "require-corp";
}
```
