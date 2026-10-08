# lesson/vendor

`mediabunny-1.59.1.js` — [mediabunny](https://github.com/Vanilagy/mediabunny) 1.59.1 (MPL-2.0, ไม่ได้แก้โค้ด)
ใช้ย่อคลิปวิดีโอในเครื่องด้วย WebCodecs (tools/lesson-layer/80-video.js) โหลดเฉพาะตอนต้องย่อคลิป

สร้างใหม่ (เอาแค่ส่วนที่ใช้ ตัดที่เหลือทิ้ง):

```
npm i mediabunny@1.59.1 esbuild@0.24.2
echo 'export { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, canEncodeVideo, canEncodeAudio } from "mediabunny";' > entry.mjs
npx esbuild entry.mjs --bundle --minify --format=esm --target=es2020 --legal-comments=inline --outfile=mediabunny-1.59.1.js
```

ซอร์สโค้ดต้นฉบับ: https://github.com/Vanilagy/mediabunny/tree/v1.59.1
