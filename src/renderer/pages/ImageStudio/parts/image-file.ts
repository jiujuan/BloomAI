// Convert user-picked local images into Data URIs for direct-to-provider img2img (v1).
// Filters non-images and oversized files; returns only the valid ones.

const MAX_BYTES = 8 * 1024 * 1024 // ~8MB per image

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= MAX_BYTES
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Read valid image files into Data URIs; silently drops invalid/oversized entries. */
export async function filesToDataUris(files: Iterable<File>): Promise<string[]> {
  const valid = Array.from(files).filter(isImageFile)
  return Promise.all(valid.map(readAsDataUri))
}

/** Extract image files from a clipboard/drag DataTransfer. */
export function imagesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  return Array.from(dt.files || []).filter(f => f.type.startsWith('image/'))
}
