function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.crossOrigin = 'anonymous'
    image.src = url
  })
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

// El recorte se aplica sobre la imagen ya rotada: si primero no se calcula el
// bounding box rotado, un giro de 90°/270° recorta contenido de los bordes.
function rotatedSize(width: number, height: number, rotation: number) {
  const rad = toRadians(rotation)
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  }
}

export interface CropPixels {
  x: number
  y: number
  width: number
  height: number
}

/** Recorta `imageSrc` al rectángulo `pixelCrop` (coordenadas sobre la imagen
 * ya rotada `rotation` grados) y devuelve un File JPEG, como la pantalla de
 * edición de fotos de WhatsApp. `pixelCrop` viene del `onCropComplete` de
 * react-easy-crop. */
export async function getCroppedImageFile(
  imageSrc: string,
  pixelCrop: CropPixels,
  rotation = 0,
  filename = 'imagen.jpg',
): Promise<File> {
  const image = await createImage(imageSrc)
  const { width: rotatedWidth, height: rotatedHeight } = rotatedSize(image.width, image.height, rotation)

  const rotationCanvas = document.createElement('canvas')
  rotationCanvas.width = rotatedWidth
  rotationCanvas.height = rotatedHeight
  const rotationCtx = rotationCanvas.getContext('2d')
  if (!rotationCtx) throw new Error('No se pudo preparar el lienzo de recorte')

  rotationCtx.translate(rotatedWidth / 2, rotatedHeight / 2)
  rotationCtx.rotate(toRadians(rotation))
  rotationCtx.drawImage(image, -image.width / 2, -image.height / 2)

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = pixelCrop.width
  cropCanvas.height = pixelCrop.height
  const cropCtx = cropCanvas.getContext('2d')
  if (!cropCtx) throw new Error('No se pudo preparar el lienzo de recorte')

  cropCtx.drawImage(
    rotationCanvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  )

  const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('No se pudo generar la imagen recortada')
  const name = filename.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}
