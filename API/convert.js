
export const config = {
  api: {
    bodyParser: false, // Permite recibir el archivo binario completo sin límite pequeño
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // 1. Recibir los bytes del archivo .docx
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 2. Enviar a motor de conversión oficial (ejemplo Gotenberg / Cloudmersive)
    // Cloudmersive permite 800 conversiones gratuitas al mes con una API Key gratuita de https://cloudmersive.com/
    const apiKey = process.env.CLOUDMERSIVE_API_KEY || 'TU_API_KEY_AQUI';

    const response = await fetch('https://api.cloudmersive.com/convert/docx/to/pdf', {
      method: 'POST',
      headers: {
        'Apikey': apiKey,
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Error en la conversión: ' + errText });
    }

    const pdfArrayBuffer = await response.arrayBuffer();
    
    // 3. Devolver el PDF perfecto listo para abrir
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.pdf"');
    return res.send(Buffer.from(pdfArrayBuffer));
  } catch (error) {
    console.error('Error al convertir:', error);
    return res.status(500).json({ error: error.message });
  }
}
