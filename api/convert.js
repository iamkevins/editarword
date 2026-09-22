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
    // 1. Recibir los bytes del archivo Word (.docx)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }

    const apiKey = process.env.CLOUDMERSIVE_API_KEY || 'f7fdc218-4f8f-42e8-b328-265fa06b4036';

    // 2. Empaquetar como 'inputFile' tal como lo exige Cloudmersive
    const formData = new FormData();
    formData.append('inputFile', new Blob([buffer]), 'documento.docx');

    const response = await fetch('https://api.cloudmersive.com/convert/docx/to/pdf', {
      method: 'POST',
      headers: {
        'Apikey': apiKey
      },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Error del conversor: ' + errText });
    }

    const pdfArrayBuffer = await response.arrayBuffer();

    // 3. Devolver el PDF vectorial nativo para el visor
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(Buffer.from(pdfArrayBuffer));
  } catch (error) {
    console.error('Error al convertir:', error);
    return res.status(500).json({ error: error.message });
  }
}
