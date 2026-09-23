
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  const { status, url } = req.body;

  // Status 2 indica que el documento está listo para guardarse
  // Status 6 indica que se forzó el guardado
  if (status === 2 || status === 6) {
    try {
      console.log("Nueva versión del archivo .docx generada en:", url);

      // Aquí puedes descargar el archivo actualizado:
      // const response = await fetch(url);
      // const buffer = await response.arrayBuffer();

      // En Vercel, al ser serverless, para persistir el archivo se suele enviar a:
      // 1. Vercel Blob (@vercel/blob)
      // 2. Un bucket S3 / Supabase Storage
      // 3. O crear un commit automático en tu GitHub con el archivo nuevo

      // Confirmar a OnlyOffice que la recepción fue exitosa
      return res.status(200).json({ error: 0 });
    } catch (error) {
      console.error("Error al procesar el guardado:", error);
      return res.status(500).json({ error: 1 });
    }
  }

  // Para otros estados (usuario conectado, esperando, etc.)
  return res.status(200).json({ error: 0 });
}
