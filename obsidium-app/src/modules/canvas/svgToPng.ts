export function svgToPngBlob(svg: string, maxSide = 4096): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    const fail = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('svg-to-png-failed'));
    };
    image.onload = () => {
      try {
        const scale = Math.min(2, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(sourceUrl);
          if (blob) resolve(blob);
          else reject(new Error('svg-to-png-failed'));
        }, 'image/png');
      } catch {
        fail();
      }
    };
    image.onerror = fail;
    image.src = sourceUrl;
  });
}

export async function copyPngToClipboard(svg: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard || typeof ClipboardItem === 'undefined') return false;
  const blob = await svgToPngBlob(svg);
  await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}
