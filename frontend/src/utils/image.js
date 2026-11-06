// 사진 줄이기(압축): 휴대폰 사진(수 MB)을 작은 JPEG 로 줄여서 올림
//   maxSize: 긴 변 최대 픽셀, quality: 처음 화질(0~1), maxBytes: 1장 목표 용량
//   목표보다 크면 화질을 조금씩 낮추고(0.5까지), 그래도 크면 크기를 한 단계씩 더 줄임
//   기본값: 긴 변 1280px · 화질 0.7 · 약 300KB — 영수증·하자 부위는 충분히 보임 (원본 3~5MB → 보통 150~300KB)
export function compressImage(file, { maxSize = 1280, quality = 0.7, maxBytes = 300 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('사진 파일만 첨부할 수 있습니다.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const draw = (scale) => {
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      // data URL 글자 수 → 실제 용량 (base64 는 4글자 = 3바이트)
      const bytes = (d) => Math.round((d.length - d.indexOf(',') - 1) * 0.75);
      let scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      draw(scale);
      let q = quality;
      let data = canvas.toDataURL('image/jpeg', q);
      while (bytes(data) > maxBytes && q > 0.5) {
        q = Math.round((q - 0.1) * 10) / 10;
        data = canvas.toDataURL('image/jpeg', q);
      }
      // 화질을 낮춰도 크면 크기를 줄임 (긴 변 640px 아래로는 줄이지 않음)
      while (bytes(data) > maxBytes && Math.max(canvas.width, canvas.height) > 640) {
        scale *= 0.85;
        draw(scale);
        data = canvas.toDataURL('image/jpeg', q);
      }
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 읽지 못했습니다. 다른 사진을 골라 주세요.'));
    };
    img.src = url;
  });
}
