pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDocInstance = null;
let originalPdfBytes = null;
let fabricCanvas = null;
let currentPageNumber = 1;
let totalPages = 1;
const RENDER_SCALE = 1.5;

// Almacén de modificaciones por página
const pagesData = {};

// Historial (Deshacer / Rehacer)
const undoStack = [];
const redoStack = [];

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const pdfCanvas = document.getElementById('pdf-canvas');
const textDetectLayer = document.getElementById('text-detect-layer');
const emptyState = document.getElementById('empty-state');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const statusBadge = document.getElementById('status-badge');

// Paginador
const btnPageSelector = document.getElementById('btn-page-selector');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const pageModalBackdrop = document.getElementById('page-modal-backdrop');
const closePageModal = document.getElementById('close-page-modal');
const pageButtonsGrid = document.getElementById('page-buttons-grid');

// Menú
const openToolsBtn = document.getElementById('open-tools-btn');
const closeToolsBtn = document.getElementById('close-tools-btn');
const sheetBackdrop = document.getElementById('sheet-backdrop');

const docInput = document.getElementById('doc-input');
const btnModeEditText = document.getElementById('btn-mode-edit-text');
const btnDraw = document.getElementById('btn-draw');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnSave = document.getElementById('btn-save');

let isEditModeActive = false;
let activeInlineInput = null;
let layerSequence = 0;

// =========================================================
// CARGADOR SEGURO DE PDF-LIB
// =========================================================
async function getSafePDFLib() {
  if (window.PDFLib) return window.PDFLib;
  if (window.pdfLib) return window.pdfLib;

  const fallbackUrls = [
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.9/dist/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
  ];

  for (const url of fallbackUrls) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window.PDFLib || window.pdfLib) return window.PDFLib || window.pdfLib;
    } catch (e) {
      console.warn('Fallo cargando CDN:', url);
    }
  }
  throw new Error('No se pudo cargar la librería PDF-Lib.');
}

// =========================================================
// HISTORIAL ACTIVO (DESHACER / REHACER)
// =========================================================
function updateUndoRedoUI() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

function pushHistoryAction(action) {
  undoStack.push(action);
  redoStack.length = 0;
  updateUndoRedoUI();
}

// Prevenir pérdida de foco en móvil
btnUndo.addEventListener('pointerdown', (e) => e.preventDefault());
btnRedo.addEventListener('pointerdown', (e) => e.preventDefault());

btnUndo.addEventListener('click', () => {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();

  if (action.type === 'FABRIC_ADD') {
    fabricCanvas.remove(action.object);
    fabricCanvas.renderAll();
  } else if (action.type === 'TEXT_EDIT') {
    // Restaurar canvas original
    const ctx = pdfCanvas.getContext('2d');
    ctx.putImageData(action.eraseData.imageData, action.eraseData.box.x, action.eraseData.box.y);
    fabricCanvas.remove(action.textRender);
    fabricCanvas.renderAll();

    const pagePatches = pagesData[currentPageNumber].patches;
    pagesData[currentPageNumber].patches = pagePatches.filter(p => p !== action.patchRef);
    if (action.domElement) action.domElement.style.display = 'block';
  }

  redoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción deshecha';
});

btnRedo.addEventListener('click', () => {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();

  if (action.type === 'FABRIC_ADD') {
    fabricCanvas.add(action.object);
    fabricCanvas.renderAll();
  } else if (action.type === 'TEXT_EDIT') {
    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = action.eraseData.bgColor;
    ctx.fillRect(action.eraseData.box.x, action.eraseData.box.y, action.eraseData.box.w, action.eraseData.box.h);
    fabricCanvas.add(action.textRender);
    fabricCanvas.renderAll();

    pagesData[currentPageNumber].patches.push(action.patchRef);
    if (action.domElement) action.domElement.style.display = 'none';
  }

  undoStack.push(action);
  updateUndoRedoUI();
  statusBadge.textContent = 'Acción rehecha';
});

// Atajos de teclado Ctrl+Z / Ctrl+Y
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? btnRedo.click() : btnUndo.click();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    btnRedo.click();
  }
});

// =========================================================
// NAVEGACIÓN Y ZOOM MULTITÁCTIL CON 2 DEDOS
// =========================================================
let zoom = 1.0;
let panX = 0;
let panY = 0;

function updateTransform() {
  sheetWrapper.style.transform = `translate3d(${panX}px, ${panY}px, 0px) scale(${zoom})`;
}

function centerDocument(w, h) {
  const vW = window.innerWidth;
  const vH = window.innerHeight;
  const scale = (vW * 0.94) / w;
  zoom = Math.min(scale, 1.0);
  panX = (vW - (w * zoom)) / 2;
  panY = Math.max(25, (vH - (h * zoom)) / 2);
  updateTransform();
}

let isTwoFinger = false;
let initialDist = 0;
let initialZoom = 1.0;
let initialMid = { x: 0, y: 0 };
let initialPan = { x: 0, y: 0 };

viewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    isTwoFinger = true;
    initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    initialZoom = zoom;
    initialMid = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };
    initialPan = { x: panX, y: panY };
  }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  if (isTwoFinger && e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const mid = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };

    if (initialDist > 0) {
      const targetZoom = Math.min(Math.max(initialZoom * (dist / initialDist), 0.35), 4.5);
      const anchorX = (initialMid.x - initialPan.x) / initialZoom;
      const anchorY = (initialMid.y - initialPan.y) / initialZoom;

      panX = mid.x - (anchorX * targetZoom);
      panY = mid.y - (anchorY * targetZoom);
      zoom = targetZoom;
      updateTransform();
    }
  }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  if (isTwoFinger && e.touches.length < 2) isTwoFinger = false;
});

// =========================================================
// CONVERSIÓN EN BACKEND DE WORD (.DOCX) A ALTA FIDELIDAD
// =========================================================
async function convertDocxToPdfBackend(file) {
  statusBadge.textContent = 'Procesando Word nativo...';
  const buffer = await file.arrayBuffer();

  const res = await fetch('/api/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: buffer
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || 'El servicio no pudo procesar el archivo Word.');
  }

  return await res.arrayBuffer();
}

// =========================================================
// CARGA EXCLUSIVA DE WORD (.DOCX)
// =========================================================
docInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  sheetBackdrop.classList.remove('active');

  try {
    const pdfBuffer = await convertDocxToPdfBackend(file);

    originalPdfBytes = pdfBuffer.slice(0);
    pdfDocInstance = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    totalPages = pdfDocInstance.numPages;

    for (let i = 1; i <= totalPages; i++) {
      pagesData[i] = { patches: [], fabricObjectsJson: null };
    }

    setupPaginationUI();
    await loadPage(1);

    emptyState.style.display = 'none';
    sheetWrapper.style.display = 'block';
    document.querySelectorAll('.disabled-tool').forEach(b => b.classList.remove('disabled-tool'));
    statusBadge.textContent = `Word listo (${totalPages} pág.)`;
  } catch (err) {
    console.error(err);
    alert('Error al abrir el archivo Word: ' + err.message);
    statusBadge.textContent = 'Error al cargar';
  }
});

// =========================================================
// RENDERIZADO DE PÁGINAS Y FABRIC
// =========================================================
async function loadPage(pageNum) {
  if (activeInlineInput) commitDirectEdit();

  if (fabricCanvas && pagesData[currentPageNumber]) {
    pagesData[currentPageNumber].fabricObjectsJson = fabricCanvas.toJSON();
  }

  currentPageNumber = pageNum;

  const page = await pdfDocInstance.getPage(pageNum);
  const viewportObj = page.getViewport({ scale: RENDER_SCALE });

  pdfCanvas.width = viewportObj.width;
  pdfCanvas.height = viewportObj.height;
  sheetWrapper.style.width = `${viewportObj.width}px`;
  sheetWrapper.style.height = `${viewportObj.height}px`;

  await page.render({
    canvasContext: pdfCanvas.getContext('2d'),
    viewport: viewportObj
  }).promise;

  if (fabricCanvas) fabricCanvas.dispose();
  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    isDrawingMode: false,
    preserveObjectStacking: true,
    selection: false,
    targetFindTolerance: 18
  });

  fabricCanvas.setWidth(viewportObj.width);
  fabricCanvas.setHeight(viewportObj.height);
  fabricCanvas.freeDrawingBrush.width = 3 * RENDER_SCALE;

  fabric.Object.prototype.set({
    transparentCorners: false,
    cornerColor: '#2563eb',
    cornerStrokeColor: '#ffffff',
    borderColor: '#2563eb',
    cornerSize: 12,
    touchCornerSize: 36,
    padding: 6,
    hasRotatingPoint: false
  });

  fabricCanvas.on('path:created', (opt) => {
    opt.path.layerNum = ++layerSequence;
    pushHistoryAction({ type: 'FABRIC_ADD', object: opt.path });
  });

  if (pagesData[pageNum].fabricObjectsJson) {
    await new Promise(resolve => fabricCanvas.loadFromJSON(pagesData[pageNum].fabricObjectsJson, resolve));
  }

  await buildSmartTextLayer(page, viewportObj);

  pageIndicator.textContent = `${currentPageNumber} / ${totalPages}`;
  btnPrevPage.disabled = (currentPageNumber === 1);
  btnNextPage.disabled = (currentPageNumber === totalPages);

  document.querySelectorAll('.page-num-tile').forEach((tile, idx) => {
    tile.classList.toggle('active-page', idx + 1 === currentPageNumber);
  });

  centerDocument(viewportObj.width, viewportObj.height);
  statusBadge.textContent = `${currentPageNumber} de ${totalPages}`;
}

// =========================================================
// SISTEMA NUMÉRICO DE NAVEGACIÓN
// =========================================================
function setupPaginationUI() {
  if (totalPages > 1) {
    btnPageSelector.style.display = 'flex';
    btnPrevPage.style.display = 'flex';
    btnNextPage.style.display = 'flex';
  } else {
    btnPageSelector.style.display = 'none';
    btnPrevPage.style.display = 'none';
    btnNextPage.style.display = 'none';
  }

  pageButtonsGrid.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const tile = document.createElement('button');
    tile.className = 'page-num-tile';
    tile.textContent = `${i}`;
    tile.addEventListener('click', () => {
      loadPage(i);
      closePageModalFn();
    });
    pageButtonsGrid.appendChild(tile);
  }
}

btnPrevPage.addEventListener('click', () => {
  if (currentPageNumber > 1) loadPage(currentPageNumber - 1);
});

btnNextPage.addEventListener('click', () => {
  if (currentPageNumber < totalPages) loadPage(currentPageNumber + 1);
});

btnPageSelector.addEventListener('click', () => pageModalBackdrop.classList.add('active'));
function closePageModalFn() { pageModalBackdrop.classList.remove('active'); }
closePageModal.addEventListener('click', closePageModalFn);
pageModalBackdrop.addEventListener('click', (e) => {
  if (e.target === pageModalBackdrop) closePageModalFn();
});

// =========================================================
// SEGMENTACIÓN PRECISA: NO FUSIONA ETIQUETAS CON VALORES
// =========================================================
async function buildSmartTextLayer(page, viewportObj) {
  textDetectLayer.innerHTML = '';
  const textContent = await page.getTextContent();
  const rawItems = textContent.items;

  const items = rawItems.map(item => {
    if (!item.str || item.str.trim() === '') return null;
    const [vx, vy] = viewportObj.convertToViewportPoint(item.transform[4], item.transform[5]);
    const fHeight = (item.height || Math.abs(item.transform[3]) || 12) * RENDER_SCALE;

    const fontNameLower = (item.fontName || '').toLowerCase();
    
    // Carlito tiene la misma métrica exacta que Calibri de Word
    let family = 'Carlito, Calibri, sans-serif';
    if (fontNameLower.includes('times') || fontNameLower.includes('serif') || fontNameLower.includes('roman')) {
      family = 'Times New Roman, serif';
    } else if (fontNameLower.includes('courier') || fontNameLower.includes('mono')) {
      family = 'Courier New, monospace';
    } else if (fontNameLower.includes('arial') || fontNameLower.includes('helvetica')) {
      family = 'Arial, sans-serif';
    }

    const bold = fontNameLower.includes('bold') || fontNameLower.includes('black') || fontNameLower.includes('heavy');
    const italic = fontNameLower.includes('italic') || fontNameLower.includes('oblique');

    return {
      str: item.str,
      x: vx,
      y: vy - fHeight,
      w: item.width * RENDER_SCALE,
      h: fHeight,
      family,
      bold,
      italic,
      origPdfX: item.transform[4],
      origPdfY: item.transform[5],
      origPdfW: item.width,
      origPdfH: item.height || Math.abs(item.transform[3]) || 12
    };
  }).filter(Boolean);

  items.sort((a, b) => Math.abs(a.y - b.y) > 5 ? a.y - b.y : a.x - b.x);

  const words = [];
  let cur = null;

  items.forEach(it => {
    if (!cur) {
      cur = { ...it, fullStr: it.str, pieces: [it] };
      return;
    }

    const sameLine = Math.abs(it.y - cur.y) < (cur.h * 0.4);
    const gap = it.x - (cur.x + cur.w);

    // SOLUCIÓN CLAVE: Solo une palabras seguidas normales (espacios menores a 14px).
    // Si hay una separación grande o tabulación (como entre 'Nombre:' y 'Kevin...'),
    // los mantiene separados para que nunca se desconfigure el resto del renglón.
    const isConsecutiveWord = gap > -2 && gap < Math.max(12, cur.h * 0.85);

    if (sameLine && isConsecutiveWord) {
      const space = gap > (cur.h * 0.12) && !cur.fullStr.endsWith(' ') && !it.str.startsWith(' ');
      cur.fullStr += (space ? ' ' : '') + it.str;
      cur.w = (it.x + it.w) - cur.x;
      cur.h = Math.max(cur.h, it.h);
      cur.pieces.push(it);
    } else {
      words.push(cur);
      cur = { ...it, fullStr: it.str, pieces: [it] };
    }
  });
  if (cur) words.push(cur);

  words.forEach(word => {
    word.id = ++layerSequence;
    const el = document.createElement('div');
    el.className = 'detected-word';
    el.style.left = `${word.x - 1}px`;
    el.style.top = `${word.y - 1}px`;
    el.style.width = `${word.w + 2}px`;
    el.style.height = `${word.h + 2}px`;

    const startEdit = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openDirectWordEditor(word, el);
    };

    el.addEventListener('click', startEdit);

    let touchStart = { x: 0, y: 0 };
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (isTwoFinger) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) < 15) {
        startEdit(e);
      }
    });

    textDetectLayer.appendChild(el);
  });
}

// =========================================================
// EDICIÓN EN SITIO CON FUENTE Y TAMAÑO EXACTOS DE WORD
// =========================================================
function openDirectWordEditor(wordData, domElement) {
  if (activeInlineInput) commitDirectEdit();

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-word-input';
  input.value = wordData.fullStr;

  // Ajuste milimétrico sobre el texto
  input.style.left = `${wordData.x - 2}px`;
  input.style.top = `${wordData.y - 1}px`;
  input.style.width = `${Math.max(wordData.w + 20, 80)}px`;
  input.style.height = `${wordData.h + 2}px`;
  input.style.fontSize = `${wordData.h * 0.84}px`;
  input.style.fontFamily = wordData.family;
  input.style.fontWeight = wordData.bold ? 'bold' : 'normal';
  input.style.fontStyle = wordData.italic ? 'italic' : 'normal';
  input.style.color = '#000000';

  activeInlineInput = { input, wordData, domElement };
  textDetectLayer.appendChild(input);

  domElement.style.opacity = '0';
  input.focus();

  input.addEventListener('blur', commitDirectEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });

  statusBadge.textContent = '✏️ Corrigiendo...';
}

function commitDirectEdit() {
  if (!activeInlineInput) return;
  const { input, wordData, domElement } = activeInlineInput;
  const newStr = input.value.trim();

  input.remove();
  activeInlineInput = null;

  if (newStr === wordData.fullStr || newStr.length === 0) {
    domElement.style.opacity = '1';
    statusBadge.textContent = 'Listo';
    return;
  }

  // Tapar estrictamente solo esa palabra o bloque editado
  const ctx = pdfCanvas.getContext('2d');
  const padTop = wordData.h * 0.18;
  const padBottom = wordData.h * 0.28;
  const padX = 2;

  const boxX = Math.max(0, Math.floor(wordData.x - padX));
  const boxY = Math.max(0, Math.floor(wordData.y - padTop));
  const boxW = Math.ceil(wordData.w + (padX * 2));
  const boxH = Math.ceil(wordData.h + padTop + padBottom);

  const originalImageData = ctx.getImageData(boxX, boxY, boxW, boxH);
  const bgColor = getBackgroundColorAround(wordData.x, wordData.y);

  ctx.fillStyle = bgColor;
  ctx.fillRect(boxX, boxY, boxW, boxH);

  domElement.style.display = 'none';

  // Renderizar la corrección con la misma métrica de Word
  const newTextRender = new fabric.Text(newStr, {
    left: wordData.x,
    top: wordData.y,
    fontSize: Math.round(wordData.origPdfH) * RENDER_SCALE,
    fontFamily: wordData.family.split(',')[0],
    fontWeight: wordData.bold ? 'bold' : 'normal',
    fontStyle: wordData.italic ? 'italic' : 'normal',
    fill: '#000000',
    selectable: false,
    hasControls: false,
    hasBorders: false
  });

  newTextRender.layerNum = wordData.id;
  fabricCanvas.add(newTextRender);
  fabricCanvas.renderAll();

  const patchRef = {
    originalLine: wordData,
    newText: newStr,
    fontFamily: wordData.family,
    bold: wordData.bold,
    italic: wordData.italic,
    fontSize: Math.round(wordData.origPdfH),
    color: '#000000',
    textRender: newTextRender
  };

  pagesData[currentPageNumber].patches.push(patchRef);

  pushHistoryAction({
    type: 'TEXT_EDIT',
    textRender: newTextRender,
    patchRef,
    domElement,
    eraseData: { imageData: originalImageData, bgColor, box: { x: boxX, y: boxY, w: boxW, h: boxH } }
  });

  statusBadge.textContent = 'Palabra corregida';
}

function getBackgroundColorAround(x, y) {
  try {
    const ctx = pdfCanvas.getContext('2d');
    const pixel = ctx.getImageData(Math.max(0, Math.floor(x - 5)), Math.max(0, Math.floor(y - 5)), 1, 1).data;
    return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  } catch (err) {
    return '#ffffff';
  }
}

// =========================================================
// MODO CORREGIR
// =========================================================
btnModeEditText.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isEditModeActive = !isEditModeActive;

  textDetectLayer.classList.toggle('interactive', isEditModeActive);
  btnModeEditText.classList.toggle('active-state', isEditModeActive);

  if (isEditModeActive) {
    statusBadge.textContent = '✏️ Toca cualquier palabra para corregir';
  } else {
    if (activeInlineInput) commitDirectEdit();
    statusBadge.textContent = 'Modo normal';
  }
});

// =========================================================
// OTRAS HERRAMIENTAS
// =========================================================
openToolsBtn.addEventListener('click', () => sheetBackdrop.classList.add('active'));
closeToolsBtn.addEventListener('click', () => sheetBackdrop.classList.remove('active'));
sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === sheetBackdrop) sheetBackdrop.classList.remove('active');
});

let isDrawing = false;
btnDraw.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  isDrawing = !isDrawing;
  fabricCanvas.isDrawingMode = isDrawing;
  btnDraw.classList.toggle('active-state', isDrawing);
  statusBadge.textContent = isDrawing ? '🖊️ Modo firma activo' : 'Documento listo';
});

btnResetZoom.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  centerDocument(pdfCanvas.width, pdfCanvas.height);
});

// =========================================================
// EXPORTACIÓN A PDF EXACTO (SOLO AL FINALIZAR)
// =========================================================
function base64ToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binaryStr = window.atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

btnSave.addEventListener('click', async () => {
  if (activeInlineInput) commitDirectEdit();

  sheetBackdrop.classList.remove('active');
  if (!originalPdfBytes) return;

  statusBadge.textContent = 'Generando PDF final...';

  try {
    const PDFLibEngine = await getSafePDFLib();
    const pdfDoc = await PDFLibEngine.PDFDocument.load(originalPdfBytes);

    const fonts = {
      sans: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.Helvetica),
      sansBold: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.HelveticaBold),
      serif: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.TimesRoman),
      serifBold: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.TimesRomanBold),
      mono: await pdfDoc.embedFont(PDFLibEngine.StandardFonts.Courier)
    };

    function mapFont(family, bold) {
      const fam = (family || '').toLowerCase();
      if (fam.includes('times') || fam.includes('serif')) return bold ? fonts.serifBold : fonts.serif;
      if (fam.includes('courier') || fam.includes('mono')) return fonts.mono;
      return bold ? fonts.sansBold : fonts.sans;
    }

    function hexToRgb(hex) {
      const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return res ? PDFLibEngine.rgb(parseInt(res[1], 16) / 255, parseInt(res[2], 16) / 255, parseInt(res[3], 16) / 255) : PDFLibEngine.rgb(0, 0, 0);
    }

    if (fabricCanvas && pagesData[currentPageNumber]) {
      pagesData[currentPageNumber].fabricObjectsJson = fabricCanvas.toJSON();
    }

    for (let pNum = 1; pNum <= totalPages; pNum++) {
      const page = pdfDoc.getPage(pNum - 1);
      const { width: pW, height: pH } = page.getSize();
      const pData = pagesData[pNum];

      if (pData) {
        for (const patch of pData.patches) {
          const line = patch.originalLine;
          const firstPiece = line.pieces[0];
          const totalW = line.pieces.reduce((sum, p) => sum + p.origPdfW, 0);

          page.drawRectangle({
            x: firstPiece.origPdfX - 2,
            y: firstPiece.origPdfY - (firstPiece.origPdfH * 0.32),
            width: Math.max(totalW, (line.w / RENDER_SCALE)) + 4,
            height: firstPiece.origPdfH * 1.4,
            color: PDFLibEngine.rgb(1, 1, 1)
          });

          if (patch.newText.trim().length > 0) {
            const font = mapFont(patch.fontFamily, patch.bold);
            const targetPdfX = patch.textRender.left / RENDER_SCALE;
            const targetPdfY = pH - (patch.textRender.top / RENDER_SCALE) - patch.fontSize;

            page.drawText(patch.newText, {
              x: targetPdfX,
              y: targetPdfY,
              size: patch.fontSize,
              font: font,
              color: hexToRgb(patch.color)
            });
          }
        }
      }
    }

    const activeObjects = fabricCanvas.getObjects().filter(o => o.type !== 'text');
    if (activeObjects.length > 0) {
      fabricCanvas.getObjects().forEach(o => { if (o.type === 'text') o.visible = false; });
      fabricCanvas.renderAll();

      const pngUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 / RENDER_SCALE });
      const imgBytes = base64ToUint8Array(pngUrl);
      const embeddedImg = await pdfDoc.embedPng(imgBytes);

      fabricCanvas.getObjects().forEach(o => { o.visible = true; });
      fabricCanvas.renderAll();

      const curPage = pdfDoc.getPage(currentPageNumber - 1);
      const { width: pW, height: pH } = curPage.getSize();
      curPage.drawImage(embeddedImg, { x: 0, y: 0, width: pW, height: pH });
    }

    const resultBytes = await pdfDoc.save();
    const blob = new Blob([resultBytes], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadUrl;
    a.download = 'documento_final.pdf';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    }, 2000);

    statusBadge.textContent = '¡PDF descargado con éxito!';
  } catch (err) {
    console.error(err);
    alert('Error al generar el PDF: ' + err.message);
    statusBadge.textContent = 'Error al descargar';
  }
});
