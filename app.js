let currentFileName = 'documento';
let docSections = [];
let currentPageIndex = 0;

// Historial en memoria para Deshacer / Rehacer
const undoStack = [];
const redoStack = [];
let isApplyingHistory = false;
let historyDebounceTimer = null;

// DOM
const viewport = document.getElementById('viewport');
const sheetWrapper = document.getElementById('sheet-wrapper');
const docContent = document.getElementById('doc-content');
const emptyState = document.getElementById('empty-state');
const gridOverlay = document.getElementById('grid-overlay');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const statusBadge = document.getElementById('status-badge');

const btnPageSelector = document.getElementById('btn-page-selector');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const pageModalBackdrop = document.getElementById('page-modal-backdrop');
const closePageModal = document.getElementById('close-page-modal');
const pageButtonsGrid = document.getElementById('page-buttons-grid');

const btnToggleGrid = document.getElementById('btn-toggle-grid');
const openToolsBtn = document.getElementById('open-tools-btn');
const closeToolsBtn = document.getElementById('close-tools-btn');
const sheetBackdrop = document.getElementById('sheet-backdrop');

const docInput = document.getElementById('doc-input');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnSavePdf = document.getElementById('btn-save-pdf');

// =========================================================
// HISTORIAL INTELIGENTE (DESHACER / REHACER ACTIVO)
// =========================================================
function updateUndoRedoUI() {
  btnUndo.disabled = undoStack.length <= 1;
  btnRedo.disabled = redoStack.length === 0;
}

function saveStateSnapshot() {
  if (isApplyingHistory || docSections.length === 0) return;

  const snapshot = docSections.map(sec => sec.innerHTML);
  undoStack.push(snapshot);
  redoStack.length = 0;
  updateUndoRedoUI();
}

function applySnapshot(snapshot) {
  isApplyingHistory = true;
  snapshot.forEach((html, i) => {
    if (docSections[i]) {
      docSections[i].innerHTML = html;
    }
  });
  isApplyingHistory = false;
  updateUndoRedoUI();
}

// SOLUCIÓN CLAVE EN MÓVILES: Previene que el botón robe el foco del cursor
btnUndo.addEventListener('pointerdown', (e) => e.preventDefault());
btnRedo.addEventListener('pointerdown', (e) => e.preventDefault());

btnUndo.addEventListener('click', () => {
  const nativeSuccess = document.execCommand('undo', false, null);
  
  if (!nativeSuccess && undoStack.length > 1) {
    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const previousState = undoStack[undoStack.length - 1];
    applySnapshot(previousState);
    statusBadge.textContent = 'Acción deshecha';
  }
  updateUndoRedoUI();
});

btnRedo.addEventListener('click', () => {
  const nativeSuccess = document.execCommand('redo', false, null);
  if (!nativeSuccess && redoStack.length > 0) {
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    applySnapshot(nextState);
    statusBadge.textContent = 'Acción rehecha';
  }
  updateUndoRedoUI();
});

// Atajos universales Ctrl+Z y Ctrl+Y
window.addEventListener('keydown', (e) => {
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

function centerDocument(w = 794, h = 1123) {
  const vW = window.innerWidth;
  const vH = window.innerHeight;
  const scale = (vW * 0.94) / w;
  zoom = Math.min(scale, 1.0);
  panX = (vW - (w * zoom)) / 2;
  panY = Math.max(30, (vH - (h * zoom)) / 2);
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
// CARGA NATIVA DE WORD (.DOCX) Y ELIMINACIÓN DE HOJAS FANTASMA
// =========================================================
docInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name.replace(/\.[^/.]+$/, "");
  sheetBackdrop.classList.remove('active');
  statusBadge.textContent = 'Abriendo Word nativo...';

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const arrayBuffer = event.target.result;
      docContent.innerHTML = '';

      const docxLib = window.docx || window.docxPreview;

      const options = {
        className: 'docx',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true, // CLAVE: evita que 2 páginas se dupliquen a 3 o 4
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true
      };

      await docxLib.renderAsync(arrayBuffer, docContent, null, options);

      // Detectar las hojas reales generadas
      let sections = Array.from(docContent.querySelectorAll('section.docx'));

      // Purgar cualquier hoja vacía residual al final del archivo
      for (let i = sections.length - 1; i > 0; i--) {
        const sec = sections[i];
        const hasMedia = sec.querySelector('img, table, canvas, svg');
        const text = (sec.innerText || '').trim();
        if (!hasMedia && text.length === 0) {
          sec.remove();
        }
      }

      sections = Array.from(docContent.querySelectorAll('section.docx'));
      docSections = sections.length > 0 ? sections : [docContent];

      // ACTIVACIÓN DE ESCRITURA EN SITIO (COMO MICROSOFT WORD)
      docSections.forEach((sec) => {
        sec.contentEditable = 'true';
        sec.spellcheck = false;

        // Escucha en tiempo real para el historial
        sec.addEventListener('input', () => {
          clearTimeout(historyDebounceTimer);
          historyDebounceTimer = setTimeout(() => {
            saveStateSnapshot();
          }, 350);
          statusBadge.textContent = 'Editando...';
        });
      });

      // Estado inicial en el historial
      undoStack.length = 0;
      redoStack.length = 0;
      saveStateSnapshot();

      emptyState.style.display = 'none';
      sheetWrapper.style.display = 'block';

      setupPaginationUI();
      showPage(0);

      document.querySelectorAll('.disabled-tool').forEach(b => b.classList.remove('disabled-tool'));
      statusBadge.textContent = `Word listo (${docSections.length} pág.)`;
    } catch (err) {
      console.error(err);
      alert('Error al abrir el archivo Word: ' + err.message);
      statusBadge.textContent = 'Error al abrir';
    }
  };
  reader.readAsArrayBuffer(file);
});

// =========================================================
// SISTEMA NUMÉRICO DE NAVEGACIÓN (1 / 2)
// =========================================================
function setupPaginationUI() {
  const total = docSections.length;

  if (total > 1) {
    btnPageSelector.style.display = 'flex';
    btnPrevPage.style.display = 'flex';
    btnNextPage.style.display = 'flex';
  } else {
    btnPageSelector.style.display = 'none';
    btnPrevPage.style.display = 'none';
    btnNextPage.style.display = 'none';
  }

  pageButtonsGrid.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const tile = document.createElement('button');
    tile.className = 'page-num-tile';
    tile.textContent = `${i + 1}`;
    tile.addEventListener('click', () => {
      showPage(i);
      closePageModalFn();
    });
    pageButtonsGrid.appendChild(tile);
  }
}

function showPage(pageIndex) {
  if (pageIndex < 0 || pageIndex >= docSections.length) return;
  currentPageIndex = pageIndex;

  // Mostrar únicamente la hoja seleccionada
  docSections.forEach((sec, idx) => {
    sec.style.display = (idx === currentPageIndex) ? 'block' : 'none';
  });

  pageIndicator.textContent = `${currentPageIndex + 1} / ${docSections.length}`;
  btnPrevPage.disabled = (currentPageIndex === 0);
  btnNextPage.disabled = (currentPageIndex === docSections.length - 1);

  document.querySelectorAll('.page-num-tile').forEach((tile, idx) => {
    tile.classList.toggle('active-page', idx === currentPageIndex);
  });

  const activeSec = docSections[currentPageIndex];
  centerDocument(activeSec.offsetWidth || 794, activeSec.offsetHeight || 1123);
  statusBadge.textContent = `${currentPageIndex + 1} de ${docSections.length}`;
}

btnPrevPage.addEventListener('click', () => showPage(currentPageIndex - 1));
btnNextPage.addEventListener('click', () => showPage(currentPageIndex + 1));

btnPageSelector.addEventListener('click', () => pageModalBackdrop.classList.add('active'));
function closePageModalFn() { pageModalBackdrop.classList.remove('active'); }
closePageModal.addEventListener('click', closePageModalFn);
pageModalBackdrop.addEventListener('click', (e) => {
  if (e.target === pageModalBackdrop) closePageModalFn();
});

// =========================================================
// OTRAS HERRAMIENTAS
// =========================================================
openToolsBtn.addEventListener('click', () => sheetBackdrop.classList.add('active'));
closeToolsBtn.addEventListener('click', () => sheetBackdrop.classList.remove('active'));
sheetBackdrop.addEventListener('click', (e) => {
  if (e.target === sheetBackdrop) sheetBackdrop.classList.remove('active');
});

btnToggleGrid.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  gridOverlay.classList.toggle('active');
});

btnResetZoom.addEventListener('click', () => {
  sheetBackdrop.classList.remove('active');
  const activeSec = docSections[currentPageIndex];
  centerDocument(activeSec ? activeSec.offsetWidth : 794, activeSec ? activeSec.offsetHeight : 1123);
});

// =========================================================
// EXPORTACIÓN A PDF EXACTO (SOLO AL FINALIZAR)
// =========================================================
btnSavePdf.addEventListener('click', () => {
  if (!docSections || docSections.length === 0) return;

  sheetBackdrop.classList.remove('active');
  gridOverlay.classList.remove('active');
  statusBadge.textContent = 'Exportando PDF...';

  // Mostrar temporalmente todas las hojas para compilar el PDF completo
  docSections.forEach(sec => {
    sec.style.display = 'block';
    sec.style.boxShadow = 'none';
  });

  const opt = {
    margin: [0, 0, 0, 0],
    filename: `${currentFileName}_editado.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], before: 'section.docx:not(:first-child)' }
  };

  html2pdf().set(opt).from(docContent).save().then(() => {
    statusBadge.textContent = '¡PDF generado con éxito!';
    showPage(currentPageIndex);
  }).catch((err) => {
    console.error(err);
    alert('Error al exportar a PDF: ' + err.message);
    statusBadge.textContent = 'Error al exportar';
    showPage(currentPageIndex);
  });
});
