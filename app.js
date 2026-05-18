/**
 * SIMULADORES DE FÍSICA - ERRORES EXPERIMENTALES 2026
 * Autor: Dr. Eduardo R. Henquín
 * Basado en simuladores originales (2005)
 */

// ==========================================
// 1. ESTADO GLOBAL
// ==========================================
const CAIDA_TABLE_VISIBLE_LIMIT = 100;
const CAIDA_GRAPH_VISIBLE_LIMIT = 300;
const PROP_TABLE_VISIBLE_LIMIT = 100;

const state = {
    currentSection: 'inicio',
    caida: {
        h: 3.0,
        g: 9.81,
        experimentStarted: false,
        isFalling: false,
        sphereLanded: false,
        startTime: 0,
        theoreticalTime: 0,
        timerId: null,
        animationId: null,
        trials: [],
        demoBias: 0.120,
        demoStd: 0.060,
        results: {
            mean: 0,
            std: 0,
            se: 0,
            bias: 0
        }
    },
    balanza: {
        trueMass: 0,
        showTrueMass: false,
        mode: 'desafio', // 'practica', 'desafio'
        resolution: 'escolar', // 'escolar', 'fina'
        armsConfig: 'iguales', // 'iguales', 'variables'
        d1: 1.0,
        d2: 1.0,
        currentPesas: [], // Array de valores
        angle: 0,
        targetAngle: 0,
        isRevealed: false,
        trials: []
    },
    propagacion: {
        module: 'area',
        inputs: {
            L: 10, dL: 0.1,
            W: 5, dW: 0.1,
            H: 4, dH: 0.1,
            R: 2, dR: 0.05
        },
        trials: [],
        results: {}
    },
    dados: {
        initialized: false,
        totalRolls: 0,
        redCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        blackCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        sumCounts: Array(13).fill(0),
        combinations: {},
        isRolling: false,
        audioCtx: null
    }
};

// ==========================================
// 2. NAVEGACIÓN Y UI
// ==========================================
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.app-section');
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');

    function navigate() {
        const hash = window.location.hash || '#inicio';
        const sectionId = hash.substring(1);
        
        sections.forEach(s => s.classList.add('hidden'));
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            state.currentSection = sectionId;
            
            // Forzar redibujado al entrar a propagación (cuando ya es visible)
            if (sectionId === 'propagacion-errores') {
                setTimeout(() => {
                    updatePropBase();
                }, 0);
            }
            if (sectionId === 'dados-probabilidad') {
                setTimeout(() => {
                    dadosModule.renderChart();
                }, 0);
            }
        }

        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === hash);
        });

        navMenu.classList.remove('open');
        window.scrollTo(0, 0);
    }

    window.addEventListener('hashchange', navigate);
    navigate();

    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('open');
    });
}

// ==========================================
// 3. UTILIDADES GENERALES & ESTADÍSTICA
// ==========================================
const stats = {
    mean: arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
    sampleStd: arr => {
        if (arr.length < 2) return 0;
        const m = stats.mean(arr);
        return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (arr.length - 1));
    },
    standardError: arr => arr.length ? stats.sampleStd(arr) / Math.sqrt(arr.length) : 0,
    min: arr => arr.length ? Math.min(...arr) : 0,
    max: arr => arr.length ? Math.max(...arr) : 0,
    
    // Box-Muller para distribución normal
    gaussianRandom: (mean = 0, std = 1) => {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return num * std + mean;
    }
};

function format(val, dec = 3) {
    return Number(val).toFixed(dec);
}

function formatNumberForCSV(value, decimals = 4) {
    if (value === null || value === undefined || value === "") return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return num.toFixed(decimals).replace(".", ",");
}

function escapeCSVField(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function exportCSV(filename, headers, rows, options = {}) {
    const separator = ";";
    const bom = "\uFEFF";
    const excelSepLine = "sep=;\r\n";

    const processedHeaders = headers.map(escapeCSVField).join(separator);

    const processedRows = rows.map(row => {
        return row.map(cell => {
            if (typeof cell === "number") {
                // Si el valor es entero o tiene pocos decimales, respetamos la opción de decimales
                return formatNumberForCSV(cell, options.decimals ?? 4);
            }
            return escapeCSVField(cell);
        }).join(separator);
    }).join("\r\n");

    const content = bom + excelSepLine + processedHeaders + "\r\n" + processedRows;

    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

// ==========================================
// 4. GRÁFICOS SVG MANUALES
// ==========================================
function drawHistogram(svgId, values, theoreticalVal, meanVal) {
    const svg = document.getElementById(svgId);
    if (!svg || !values.length) {
        if(svg) svg.innerHTML = '';
        return;
    }
    
    const width = svg.clientWidth || 400;
    const height = svg.clientHeight || 250;
    const padding = 40;

    // Ajustar escala considerando si el valor teórico es visible
    let minV, maxV;
    if (theoreticalVal !== null && theoreticalVal !== undefined) {
        minV = Math.min(theoreticalVal, ...values) * 0.98;
        maxV = Math.max(theoreticalVal, ...values) * 1.02;
    } else {
        minV = Math.min(...values) * 0.98;
        maxV = Math.max(...values) * 1.02;
    }
    
    const range = maxV - minV;
    const numBins = 20; 
    const binSize = range / numBins;
    const bins = new Array(numBins).fill(0);
    
    for (let i = 0; i < values.length; i++) {
        let idx = Math.floor((values[i] - minV) / binSize);
        if (idx >= numBins) idx = numBins - 1;
        if (idx < 0) idx = 0;
        bins[idx]++;
    }

    const maxBin = Math.max(...bins, 1);
    const binWidth = (width - 2 * padding) / numBins;

    let content = "";
    const xAxisY = height - padding;
    content += `<line x1="${padding}" y1="${xAxisY}" x2="${width - padding}" y2="${xAxisY}" stroke="var(--border-color)" />`;
    
    bins.forEach((count, i) => {
        const barH = (count / maxBin) * (height - 2 * padding);
        const x = padding + i * binWidth;
        const y = xAxisY - barH;
        content += `<rect x="${x + 1}" y="${y}" width="${binWidth - 2}" height="${barH}" fill="var(--accent-blue)" opacity="0.4" />`;
    });

    const getX = v => padding + ((v - minV) / range) * (width - 2 * padding);
    
    if (theoreticalVal !== null && theoreticalVal !== undefined) {
        const tx = getX(theoreticalVal);
        content += `<line x1="${tx}" y1="${padding}" x2="${tx}" y2="${xAxisY}" stroke="var(--accent-green)" stroke-width="2" stroke-dasharray="4" />`;
        content += `<text x="${tx}" y="${padding - 5}" text-anchor="middle" fill="var(--accent-green)" font-size="10">Real</text>`;
    }

    const mx = getX(meanVal);
    content += `<line x1="${mx}" y1="${padding}" x2="${mx}" y2="${xAxisY}" stroke="var(--accent-amber)" stroke-width="2" />`;
    content += `<text x="${mx}" y="${xAxisY + 20}" text-anchor="middle" fill="var(--accent-amber)" font-size="10">Promedio</text>`;
    
    svg.innerHTML = content;
}

function drawErrorSeries(svgId, trials, theoreticalVal) {
    const svg = document.getElementById(svgId);
    const note = svgId.includes('caida') ? document.getElementById('caida-graph-note') : document.getElementById('balanza-graph-note');
    if (!svg || !trials.length) {
        if(svg) svg.innerHTML = '';
        if(note) note.innerText = '';
        return;
    }

    const width = svg.clientWidth || 400;
    const height = svg.clientHeight || 250;
    const padding = 40;
    
    const limit = svgId.includes('caida') ? CAIDA_GRAPH_VISIBLE_LIMIT : 300; 
    const total = trials.length;
    const startIdx = Math.max(0, total - limit);
    const visibleTrials = trials.slice(startIdx);
    
    if (note) {
        note.innerText = total > limit ? `Mostrando últimos ${limit} de ${total}` : "";
    }

    // El error absoluto es t.medido - ref
    const ref = (theoreticalVal !== null && theoreticalVal !== undefined) ? theoreticalVal : stats.mean(visibleTrials.map(t => t.medido));
    const errors = visibleTrials.map(t => t.medido - ref);
    
    const maxErr = Math.max(0.1, ...errors.map(Math.abs));
    const xAxisY = height / 2;
    const getY = err => xAxisY - (err / maxErr) * (height / 2 - padding);
    const getX = i => padding + (i / (visibleTrials.length > 1 ? visibleTrials.length - 1 : 1)) * (width - 2 * padding);

    let content = "";
    // Eje horizontal (Error 0)
    content += `<line x1="${padding}" y1="${xAxisY}" x2="${width - padding}" y2="${xAxisY}" stroke="var(--border-color)" stroke-dasharray="2" />`;
    
    let polyPoints = [];
    visibleTrials.forEach((t, i) => {
        const error = t.medido - ref;
        const x = getX(i);
        const y = getY(error);
        polyPoints.push(`${x},${y}`);
        
        // Color basado en si el valor real es conocido o no
        let color = 'var(--accent-blue)';
        if (theoreticalVal !== null && theoreticalVal !== undefined) {
            color = (error > 0) ? 'var(--accent-red)' : 'var(--accent-orange)';
        }
        content += `<circle cx="${x}" cy="${y}" r="3" fill="${color}" />`;
    });

    if (visibleTrials.length > 1) {
        content = `<polyline points="${polyPoints.join(' ')}" fill="none" stroke="var(--accent-blue)" stroke-width="1" opacity="0.3" />` + content;
    }
    
    svg.innerHTML = content;
}

// ==========================================
// 5. MÓDULO: CAÍDA LIBRE
// ==========================================
function updateCaidaUI() {
    const hSlider = document.getElementById('caida-h-slider');
    const hVal = document.getElementById('caida-h-val');
    const gSelect = document.getElementById('caida-g-select');
    const gNum = document.getElementById('caida-g-num');

    state.caida.h = parseFloat(hSlider.value);
    hVal.innerText = format(state.caida.h, 2) + ' m';

    if (gSelect.value === 'custom') {
        gNum.classList.remove('hidden');
        state.caida.g = parseFloat(gNum.value) || 9.81;
    } else {
        gNum.classList.add('hidden');
        state.caida.g = parseFloat(gSelect.value);
    }

    state.caida.theoreticalTime = Math.sqrt(2 * state.caida.h / state.caida.g);
    document.getElementById('res-caida-theory').innerText = format(state.caida.theoreticalTime, 3);
    
    drawCaidaSVG();
}

function updateCaidaDemoParams() {
    state.caida.demoBias = parseFloat(document.getElementById('caida-bias-slider').value);
    state.caida.demoStd = parseFloat(document.getElementById('caida-std-slider').value);
    document.getElementById('caida-bias-val').innerText = (state.caida.demoBias >= 0 ? '+' : '') + state.caida.demoBias.toFixed(2);
    document.getElementById('caida-std-val').innerText = state.caida.demoStd.toFixed(2);
}

function simulateCaidaRandomTrials(n) {
    if (!state.caida.experimentStarted) {
        alert("Primero presione 'Iniciar experimento'");
        return;
    }
    if (state.caida.isFalling) return;

    // Deshabilitar botones
    const btn10 = document.getElementById('btn-caida-demo-10');
    const btn100 = document.getElementById('btn-caida-demo-100');
    btn10.disabled = true;
    btn100.disabled = true;
    const oldText10 = btn10.innerText;
    const oldText100 = btn100.innerText;
    btn10.innerText = "Generando...";
    btn100.innerText = "Generando...";

    setTimeout(() => {
        const t_theory = state.caida.theoreticalTime;
        for (let i = 0; i < n; i++) {
            let t_medido = stats.gaussianRandom(t_theory + state.caida.demoBias, state.caida.demoStd);
            if (t_medido < 0.001) t_medido = 0.001;
            recordCaidaTrial(t_medido, "Demo", true); // skipRender = true
        }

        refreshCaidaAfterDataChange();

        // Restaurar botones
        btn10.disabled = false;
        btn100.disabled = false;
        btn10.innerText = oldText10;
        btn100.innerText = oldText100;
    }, 50);
}

function drawCaidaSVG() {
    const svg = document.getElementById('caida-svg');
    const h = state.caida.h;
    if (!svg) return;
    
    let content = "";
    // Tower/Scale
    content += `<line x1="100" y1="50" x2="100" y2="350" stroke="var(--border-color)" stroke-width="4" />`;
    for(let i=0; i<=h; i+=0.5) {
        const y = 350 - (i / h) * 300;
        content += `<line x1="95" y1="${y}" x2="105" y2="${y}" stroke="var(--text-muted)" />`;
        content += `<text x="75" y="${y+5}" fill="var(--text-muted)" font-size="10">${i.toFixed(1)}m</text>`;
    }
    // Ground
    content += `<rect x="50" y="350" width="500" height="10" fill="var(--border-color)" />`;

    // Sphere
    let sphereY = 50;
    if (state.caida.isFalling || state.caida.sphereLanded) {
        const elapsed = (performance.now() - state.caida.startTime) / 1000;
        const currentY = 0.5 * state.caida.g * Math.pow(elapsed, 2);
        sphereY = 50 + (Math.min(currentY, h) / h) * 300;
    }
    content += `<circle cx="200" cy="${sphereY}" r="12" fill="var(--accent-blue)" id="caida-sphere" />`;
    
    svg.innerHTML = content;
}

function startCaidaExperiment() {
    state.caida.experimentStarted = true;
    document.getElementById('caida-setup-controls').classList.add('hidden');
    document.getElementById('caida-active-controls').classList.remove('hidden');
    document.getElementById('caida-h-fixed').innerText = format(state.caida.h, 2) + ' m';
    document.getElementById('caida-status').innerText = 'Listo para largar';
    document.getElementById('caida-status').className = 'experiment-status status-active';
    updateCaidaDemoParams();
    drawCaidaSVG();
}

function resetCaida() {
    if (state.caida.animationId) {
        cancelAnimationFrame(state.caida.animationId);
        state.caida.animationId = null;
    }
    state.caida.experimentStarted = false;
    state.caida.isFalling = false;
    state.caida.sphereLanded = false;
    state.caida.trials = [];
    document.getElementById('caida-setup-controls').classList.remove('hidden');
    document.getElementById('caida-active-controls').classList.add('hidden');
    document.getElementById('caida-timer').innerText = '0.000 s';
    document.getElementById('caida-table-body').innerHTML = '';
    document.getElementById('caida-table-note').innerText = '';
    document.getElementById('caida-status').innerText = 'Esperando inicio';
    document.getElementById('caida-status').className = 'experiment-status status-waiting';
    document.getElementById('caida-conclusion').classList.add('hidden');
    
    // Reset stats
    ['res-caida-last', 'res-caida-ea', 'res-caida-n', 'res-caida-mean', 'res-caida-std', 'res-caida-se', 'res-caida-bias']
        .forEach(id => document.getElementById(id).innerText = (id==='res-caida-n'? '0' : '0.000'));
        
    updateCaidaUI();
}

function dropEsfera() {
    if (state.caida.isFalling) return;
    
    if (state.caida.animationId) cancelAnimationFrame(state.caida.animationId);

    state.caida.isFalling = true;
    state.caida.sphereLanded = false;
    state.caida.startTime = performance.now();
    
    document.getElementById('btn-largar-esfera').classList.add('hidden');
    document.getElementById('btn-registrar-impacto').classList.remove('hidden');
    document.getElementById('caida-status').innerText = 'Esfera cayendo...';
    
    function animate() {
        if (!state.caida.isFalling) return;
        
        const now = performance.now();
        const elapsed = (now - state.caida.startTime) / 1000;
        document.getElementById('caida-timer').innerText = format(elapsed, 3) + ' s';
        
        if (!state.caida.sphereLanded && elapsed >= state.caida.theoreticalTime) {
            state.caida.sphereLanded = true;
            document.getElementById('caida-status').innerText = '¡TOCÓ EL SUELO!';
            document.getElementById('caida-status').className = 'experiment-status status-impact';
        }
        
        drawCaidaSVG();
        state.caida.animationId = requestAnimationFrame(animate);
    }
    state.caida.animationId = requestAnimationFrame(animate);
}

function stopCronometro() {
    if (!state.caida.isFalling) return;
    
    const stopTime = performance.now();
    state.caida.isFalling = false;
    if (state.caida.animationId) {
        cancelAnimationFrame(state.caida.animationId);
        state.caida.animationId = null;
    }

    const medido = (stopTime - state.caida.startTime) / 1000;
    
    document.getElementById('btn-largar-esfera').classList.remove('hidden');
    document.getElementById('btn-registrar-impacto').classList.add('hidden');
    
    recordCaidaTrial(medido, "Manual");
}

function recordCaidaTrial(medido, tipo = "Manual", skipRender = false) {
    const theory = state.caida.theoreticalTime;
    const ea = medido - theory;
    const er = (Math.abs(ea) / theory) * 100;
    
    let clasificacion = "Correcto";
    if (medido < theory - 0.05) clasificacion = "Anticipado";
    else if (medido > theory + 0.05) clasificacion = "Tardío";
    
    const trial = {
        tipo: tipo,
        h: state.caida.h,
        g: state.caida.g,
        teorico: theory,
        medido: medido,
        ea: ea,
        er: er,
        clasificacion: clasificacion
    };
    
    state.caida.trials.push(trial);
    
    if (!skipRender) {
        refreshCaidaAfterDataChange();
    }
}

function deleteCaidaTrial(index) {
    state.caida.trials.splice(index, 1);
    refreshCaidaAfterDataChange();
}

function refreshCaidaAfterDataChange() {
    renderCaidaTable();
    updateCaidaStats();
}

function renderCaidaTable() {
    const body = document.getElementById('caida-table-body');
    const note = document.getElementById('caida-table-note');
    if (!body) return;

    const total = state.caida.trials.length;
    const fragment = document.createDocumentFragment();
    
    const startIdx = Math.max(0, total - CAIDA_TABLE_VISIBLE_LIMIT);
    
    if (total > CAIDA_TABLE_VISIBLE_LIMIT) {
        note.innerText = `Mostrando últimos ${CAIDA_TABLE_VISIBLE_LIMIT} de ${total} intentos`;
    } else {
        note.innerText = "";
    }

    // Renderizar solo los visibles
    for (let i = total - 1; i >= startIdx; i--) {
        const t = state.caida.trials[i];
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${i + 1}</td>
            <td><span class="mode-badge" style="background:${t.tipo==='Demo'?'rgba(99,102,241,0.1)':'rgba(56,189,248,0.1)'}">${t.tipo}</span></td>
            <td>${t.h.toFixed(2)}</td>
            <td>${t.g}</td>
            <td>${format(t.teorico)}</td>
            <td>${format(t.medido)}</td>
            <td>${format(t.ea)}</td>
            <td>${format(t.er, 2)}%</td>
            <td><span class="badge-${t.clasificacion.toLowerCase()}">${t.clasificacion}</span></td>
            <td><button class="btn-danger-small" onclick="deleteCaidaTrial(${i})">Eliminar</button></td>
        `;
        fragment.appendChild(row);
    }
    
    body.innerHTML = '';
    body.appendChild(fragment);
}

function updateCaidaStats() {
    const medidos = state.caida.trials.map(t => t.medido);
    const mean = stats.mean(medidos);
    const std = stats.sampleStd(medidos);
    const se = stats.standardError(medidos);
    const last = medidos.length ? medidos[medidos.length - 1] : 0;
    const theory = state.caida.theoreticalTime;

    document.getElementById('res-caida-last').innerText = medidos.length ? format(last) : "0.000";
    document.getElementById('res-caida-ea').innerText = medidos.length ? format(last - theory) : "0.000";
    document.getElementById('res-caida-n').innerText = medidos.length;
    document.getElementById('res-caida-mean').innerText = medidos.length ? format(mean) : "0.000";
    document.getElementById('res-caida-std').innerText = medidos.length ? format(std) : "0.000";
    document.getElementById('res-caida-se').innerText = medidos.length ? format(se) : "0.000";
    document.getElementById('res-caida-bias').innerText = medidos.length ? format(mean - theory) : "0.000";

    drawHistogram('caida-hist-svg', medidos, theory, mean);
    drawErrorSeries('caida-error-svg', state.caida.trials, theory);

    updateCaidaInterpretation(medidos, mean, theory, std);
}

function updateCaidaInterpretation(medidos, mean, theory, std) {
    const conclusion = document.getElementById('caida-conclusion');
    const textEl = document.getElementById('caida-interpretation-text');
    
    if (medidos.length >= 5) {
        conclusion.classList.remove('hidden');
        let txt = "";
        const bias = mean - theory;
        if (Math.abs(bias) < 0.03) txt += "Tus mediciones están muy bien centradas en el valor real. ";
        else if (bias > 0) txt += "Tiendes a reaccionar un poco tarde (sesgo positivo). ";
        else txt += "Tiendes a anticiparte al impacto (sesgo negativo). ";

        if (std > 0.1) txt += "Tienes una dispersión alta, intenta ser más consistente.";
        else txt += "Tienes buena precisión (baja dispersión).";
        
        textEl.innerText = txt;
    } else {
        conclusion.classList.add('hidden');
    }
}

function exportCaidaCSV() {
    const headers = ["Intento", "Tipo", "Altura(m)", "Gravedad(m/s2)", "Tiempo Teorico(s)", "Tiempo Medido(s)", "Error Absoluto(s)", "Error Relativo(%)", "Clasificacion"];
    const rows = state.caida.trials.map((t, i) => [
        i + 1, 
        t.tipo, 
        formatNumberForCSV(t.h, 2), 
        formatNumberForCSV(t.g, 2), 
        formatNumberForCSV(t.teorico, 4), 
        formatNumberForCSV(t.medido, 4), 
        formatNumberForCSV(t.ea, 4), 
        formatNumberForCSV(t.er, 2), 
        t.clasificacion
    ]);
    exportCSV('caida_libre_experimento.csv', headers, rows);
}

// ==========================================
// 6. MÓDULO: BALANZA DE BRAZOS
// ==========================================
function initBalanza() {
    state.balanza.trials = [];
    state.balanza.sampleId = 'M-' + Math.floor(100 + Math.random() * 900);
    nextBalanzaSample(true); // silent init
    animateBalanza();
}

function nextBalanzaSample(silent = false) {
    if (!silent && state.balanza.trials.length > 0) {
        if (!confirm("Se perderán los datos de la serie actual. ¿Deseas generar una nueva muestra?")) return;
    }

    state.balanza.trueMass = 100 + Math.random() * 400; 
    state.balanza.sampleId = 'M-' + Math.floor(100 + Math.random() * 900);
    state.balanza.currentPesas = [];
    state.balanza.isRevealed = false;
    state.balanza.trials = [];

    // En modo desafío, por defecto ocultamos el valor verdadero al iniciar nueva muestra
    const mode = document.getElementById('balanza-mode-select').value;
    if (mode === 'desafio') {
        document.getElementById('balanza-show-mass').checked = false;
        state.balanza.showTrueMass = false;
    }

    document.getElementById('balanza-sample-id').innerText = state.balanza.sampleId;
    
    refreshBalanzaAfterDataChange();
    updateBalanzaResolution();
    updateBalanzaUI();
}

function updateBalanzaResolution() {
    const res = document.getElementById('balanza-resolution-select').value;
    state.balanza.resolution = res;
    
    const container = document.getElementById('balanza-weight-buttons');
    container.innerHTML = '';
    
    const weightsEscolar = [1, 2, 5, 10, 20, 50, 100, 200];
    const weightsFina = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const weights = (res === 'escolar') ? weightsEscolar : weightsFina;
    
    weights.forEach(w => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.padding = '0.4rem';
        btn.innerText = `+${w}g`;
        btn.onclick = () => addPesa(w);
        container.appendChild(btn);
    });
}

function updateBalanzaUI() {
    // 1. Leer inputs y sincronizar state
    state.balanza.mode = document.getElementById('balanza-mode-select').value;
    state.balanza.sensitivity = parseFloat(document.getElementById('balanza-sensitivity-select').value);
    state.balanza.errorCero = parseFloat(document.getElementById('balanza-zero-slider').value);
    state.balanza.variabilidad = parseFloat(document.getElementById('balanza-var-slider').value);
    state.balanza.armsConfig = document.getElementById('balanza-arms-config').value;
    state.balanza.showTrueMass = document.getElementById('balanza-show-mass').checked;

    // 2. Actualizar labels de sliders
    document.getElementById('balanza-zero-val').innerText = (state.balanza.errorCero >= 0 ? '+' : '') + state.balanza.errorCero.toFixed(1) + ' g';
    document.getElementById('balanza-var-val').innerText = state.balanza.variabilidad.toFixed(1) + ' g';

    // 3. Configurar brazos d1/d2 una sola vez
    if (state.balanza.armsConfig === 'variables') {
        document.getElementById('balanza-dist-controls').classList.remove('hidden');
        state.balanza.d1 = parseFloat(document.getElementById('balanza-d1-slider').value);
        state.balanza.d2 = parseFloat(document.getElementById('balanza-d2-slider').value);
        document.getElementById('balanza-d1-val').innerText = state.balanza.d1.toFixed(2) + ' m';
        document.getElementById('balanza-d2-val').innerText = state.balanza.d2.toFixed(2) + ' m';
    } else {
        document.getElementById('balanza-dist-controls').classList.add('hidden');
        state.balanza.d1 = 1.0;
        state.balanza.d2 = 1.0;
    }

    // 4. Calcular suma de pesas
    const sumP = state.balanza.currentPesas.reduce((a, b) => a + b, 0);
    document.getElementById('res-balanza-pesas-live').innerText = sumP.toFixed(1);

    // 5. Mostrar u ocultar masa verdadera
    const showTrue = state.balanza.showTrueMass === true;
    const trueText = showTrue ? format(state.balanza.trueMass, 2) : "???";
    
    const trueDisplayContainer = document.getElementById('balanza-true-mass-display');
    if (trueDisplayContainer) trueDisplayContainer.classList.toggle('hidden', !showTrue);
    
    const trueValLabel = document.getElementById('balanza-true-val');
    if (trueValLabel) trueValLabel.innerText = trueText + (showTrue ? " g" : "");

    document.getElementById('res-balanza-true').innerText = trueText;

    // 6. Aplicar ocultamiento visual
    const isChallenge = (state.balanza.mode === 'desafio');
    const hiddenEls = document.querySelectorAll('.challenge-hidden');
    hiddenEls.forEach(el => el.classList.toggle('challenge-hidden', isChallenge && !showTrue));

    // 7. Calcular masa estimada, torques, ángulo y estado
    const m_est = sumP * state.balanza.d2 / state.balanza.d1;
    document.getElementById('res-balanza-med').innerText = format(m_est, 2);

    const g = 9.81;
    const t1 = (state.balanza.trueMass / 1000) * g * state.balanza.d1;
    const t2 = (sumP / 1000) * g * state.balanza.d2;
    const net = t2 - t1; 

    state.balanza.targetAngle = Math.max(-18, Math.min(18, net * 40));
    
    const tol = state.balanza.sensitivity;
    const status = document.getElementById('balanza-status');
    const absNet = Math.abs(net);

    if (absNet < tol) {
        status.innerText = "EQUILIBRIO";
        status.className = "experiment-status status-equilibrium";
    } else if (absNet < tol * 3) {
        status.innerText = "CASI EQUILIBRIO";
        status.className = "experiment-status status-near-equilibrium";
    } else {
        status.innerText = net > 0 ? "DERECHA BAJA" : "IZQUIERDA BAJA";
        status.className = net > 0 ? "experiment-status status-right-low" : "experiment-status status-left-low";
    }
}

function addPesa(val) {
    state.balanza.currentPesas.push(val);
    updateBalanzaUI();
}

function removeLastPesa() {
    state.balanza.currentPesas.pop();
    updateBalanzaUI();
}

function clearPesas() {
    state.balanza.currentPesas = [];
    updateBalanzaUI();
}

function animateBalanza() {
    state.balanza.angle += (state.balanza.targetAngle - state.balanza.angle) * 0.08;
    const svg = document.getElementById('balanza-svg');
    if (svg) {
        let content = "";
        const cx = 300, cy = 150;
        const angleRad = state.balanza.angle * Math.PI / 180;
        // Soporte
        content += `<path d="M280 350 L300 150 L320 350 Z" fill="var(--bg-surface)" stroke="var(--border-color)" />`;
        // Barra
        const x1 = cx - 200 * Math.cos(angleRad);
        const y1 = cy - 200 * Math.sin(angleRad);
        const x2 = cx + 200 * Math.cos(angleRad);
        const y2 = cy + 200 * Math.sin(angleRad);
        content += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-secondary)" stroke-width="6" />`;
        // Platos
        content += `<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y1+80}" stroke="var(--text-muted)" />`;
        content += `<path d="M${x1-40} ${y1+80} Q${x1} ${y1+100} ${x1+40} ${y1+80}" fill="none" stroke="var(--text-muted)" stroke-width="2" />`;
        content += `<line x1="${x2}" y1="${y2}" x2="${x2}" y2="${y2+80}" stroke="var(--text-muted)" />`;
        content += `<path d="M${x2-40} ${y2+80} Q${x2} ${y2+100} ${x2+40} ${y2+80}" fill="none" stroke="var(--text-muted)" stroke-width="2" />`;
        // Objeto
        content += `<rect x="${x1-15}" y="${y1+50}" width="30" height="30" fill="var(--accent-purple)" rx="4" />`;
        
        // Pesas (Bloque y Texto agrandado)
        const sumP = state.balanza.currentPesas.reduce((a, b) => a + b, 0);
        if (sumP > 0) {
            const blockW = 48;
            const blockH = 28;
            // Dibujar el bloque de pesas
            content += `<rect x="${x2 - blockW/2}" y="${y2 + 65}" width="${blockW}" height="${blockH}" fill="var(--accent-amber)" rx="4" stroke="rgba(251,191,36,0.3)" stroke-width="1" />`;
            // Texto de peso con borde para máxima legibilidad
            content += `
                <text 
                  x="${x2}" 
                  y="${y2 + 55}" 
                  text-anchor="middle" 
                  fill="var(--accent-amber)" 
                  font-size="24" 
                  font-weight="900"
                  paint-order="stroke"
                  stroke="#020617"
                  stroke-width="5">
                  ${format(sumP, 1)} g
                </text>`;
        }
        svg.innerHTML = content;
    }
    requestAnimationFrame(animateBalanza);
}

function simulateBalanzaTrials(n) {
    const btn10 = document.getElementById('btn-balanza-demo-10');
    const btn100 = document.getElementById('btn-balanza-demo-100');
    btn10.disabled = true; btn100.disabled = true;

    setTimeout(() => {
        const trueM = state.balanza.trueMass;
        const d1 = state.balanza.d1;
        const d2 = state.balanza.d2;
        const res = state.balanza.resolution === 'escolar' ? 1 : 0.1;

        for (let i = 0; i < n; i++) {
            // M_aparente = M_real + error_cero + randomNormal(0, variabilidad)
            const apparentM = trueM + state.balanza.errorCero + stats.gaussianRandom(0, state.balanza.variabilidad);
            // masa_pesas_necesaria = M_aparente * d1 / d2
            const masaPesasNeeded = apparentM * d1 / d2;
            // Redondear a resolución
            const sumPesas = Math.round(masaPesasNeeded / res) * res;
            recordBalanzaMedicionBatch(sumPesas, apparentM);
        }
        refreshBalanzaAfterDataChange();
        btn10.disabled = false; btn100.disabled = false;
    }, 50);
}

function recordBalanzaMedicionBatch(sumP, apparentM) {
    const trueM = state.balanza.trueMass;
    const d1 = state.balanza.d1;
    const d2 = state.balanza.d2;
    const med = sumP * d2 / d1;
    const ea = med - trueM;
    const er = (Math.abs(ea) / trueM) * 100;
    
    const g = 9.81;
    const t1 = (trueM / 1000) * g * d1;
    const t2 = (sumP / 1000) * g * d2;
    const tol = state.balanza.sensitivity;
    const absNet = Math.abs(t2 - t1);
    const estado = absNet < tol ? "Equilibrio" : (t2 > t1 ? "Derecha baja" : "Izquierda baja");

    const trial = {
        ensayo: state.balanza.trials.length + 1,
        tipo: "Demo",
        trueM, apparentM, med, sumP,
        pesas: "Simulado",
        d1, d2, ea, er, estado
    };
    state.balanza.trials.push(trial);
}

function recordBalanzaMedicion() {
    const sumP = state.balanza.currentPesas.reduce((a, b) => a + b, 0);
    const trueM = state.balanza.trueMass;
    const d1 = state.balanza.d1;
    const d2 = state.balanza.d2;
    const med = sumP * d2 / d1;
    
    // En medición manual, la "masa aparente" es lo que el alumno Cree que mide
    // No la calculamos con ruido porque el ruido es el alumno.
    const trial = {
        ensayo: state.balanza.trials.length + 1,
        tipo: "Manual",
        trueM, apparentM: med, med, sumP,
        pesas: state.balanza.currentPesas.join('+'),
        d1, d2, ea: med - trueM, er: (Math.abs(med - trueM) / trueM) * 100,
        estado: document.getElementById('balanza-status').innerText
    };
    state.balanza.trials.push(trial);
    refreshBalanzaAfterDataChange();
}

function deleteBalanzaTrial(index) {
    state.balanza.trials.splice(index, 1);
    refreshBalanzaAfterDataChange();
}

function refreshBalanzaAfterDataChange() {
    // Renumerar
    state.balanza.trials.forEach((t, i) => t.ensayo = i + 1);
    renderBalanzaTable();
    updateBalanzaStats();
}

function renderBalanzaTable() {
    const body = document.getElementById('balanza-table-body');
    const note = document.getElementById('balanza-table-note');
    if (!body) return;

    const total = state.balanza.trials.length;
    const fragment = document.createDocumentFragment();
    const startIdx = Math.max(0, total - CAIDA_TABLE_VISIBLE_LIMIT);
    
    note.innerText = total > CAIDA_TABLE_VISIBLE_LIMIT ? `Mostrando últimos ${CAIDA_TABLE_VISIBLE_LIMIT} de ${total} pesadas` : "";

    for (let i = total - 1; i >= startIdx; i--) {
        const t = state.balanza.trials[i];
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${t.ensayo}</td>
            <td><span class="mode-badge" style="background:${t.tipo==='Demo'?'rgba(99,102,241,0.1)':'rgba(56,189,248,0.1)'}">${t.tipo}</span></td>
            <td>${format(t.trueM, 2)}</td>
            <td>${format(t.apparentM, 2)}</td>
            <td>${format(t.med, 2)}</td>
            <td style="font-size:0.7rem; max-width:120px; overflow:hidden; text-overflow:ellipsis;" title="${t.pesas}">${t.pesas}</td>
            <td>${(t.d1/t.d2).toFixed(2)}</td>
            <td>${format(t.ea, 2)}</td>
            <td>${format(t.er, 2)}%</td>
            <td>${t.estado}</td>
            <td><button class="btn-danger-small" onclick="deleteBalanzaTrial(${i})">Eliminar</button></td>
        `;
        fragment.appendChild(row);
    }
    body.innerHTML = '';
    body.appendChild(fragment);
}

function updateBalanzaStats() {
    const trials = state.balanza.trials;
    const meds = trials.map(t => t.med);
    const n = meds.length;
    
    document.getElementById('balanza-n-count').innerText = n;
    document.getElementById('res-balanza-n').innerText = n;

    if (n === 0) {
        ['res-balanza-mean', 'res-balanza-std', 'res-balanza-se', 'res-balanza-bias', 'res-balanza-range'].forEach(id => document.getElementById(id).innerText = "0.000");
        drawHistogram('balanza-hist-svg', [], 0, 0);
        drawErrorSeries('balanza-error-svg', [], 0);
        document.getElementById('balanza-interpretation-card').classList.add('hidden');
        return;
    }

    const mean = stats.mean(meds);
    const std = stats.sampleStd(meds);
    const se = stats.standardError(meds);
    const trueM = state.balanza.trueMass;
    const range = meds.length > 0 ? (Math.max(...meds) - Math.min(...meds)) : 0;
    const showTrue = state.balanza.showTrueMass === true;

    document.getElementById('res-balanza-mean').innerText = format(mean, 2);
    document.getElementById('res-balanza-std').innerText = format(std, 3);
    document.getElementById('res-balanza-se').innerText = format(se, 3);
    document.getElementById('res-balanza-bias').innerText = showTrue ? format(mean - trueM, 3) : "???";
    document.getElementById('res-balanza-range').innerText = format(range, 2);

    // En el histograma, pasamos null si está oculto para que no dibuje la línea real
    drawHistogram('balanza-hist-svg', meds, showTrue ? trueM : null, mean);
    
    const adaptedTrials = trials.map(t => ({ medido: t.med }));
    drawErrorSeries('balanza-error-svg', adaptedTrials, showTrue ? trueM : null);

    updateBalanzaInterpretation(n, mean, trueM, std, range);
}

function updateBalanzaInterpretation(n, mean, trueM, std, range) {
    const card = document.getElementById('balanza-interpretation-card');
    const container = document.getElementById('balanza-interpretation');
    if (n < 5) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    const bias = mean - trueM;
    const res = state.balanza.resolution === 'escolar' ? 1 : 0.1;
    
    let txt = `<p>• Se han analizado ${n} mediciones de la muestra ${state.balanza.sampleId}.</p>`;
    if (Math.abs(bias) > res) {
        txt += `<p>• Existe un <strong>sesgo sistemático</strong> apreciable (${format(bias, 2)}g), posiblemente debido al error de cero o asimetría.</p>`;
    } else {
        txt += `<p>• El promedio está bien centrado respecto al valor real.</p>`;
    }
    
    if (std > res * 2) {
        txt += `<p>• La <strong>dispersión aleatoria</strong> es significativa. La variabilidad del observador o la baja sensibilidad están afectando la precisión.</p>`;
    } else {
        txt += `<p>• Tienes buena repetibilidad (precisión alta).</p>`;
    }

    if (state.balanza.resolution === 'escolar' && range < 2) {
        txt += `<p>• La resolución de 1g está limitando tu capacidad de ver la distribución real (efecto de cuantización).</p>`;
    }
    
    container.innerHTML = txt;
}

function exportBalanzaCSV() {
    const headers = ["Ensayo", "Tipo", "Masa Verdadera(g)", "Masa Aparente(g)", "Masa Estimada(g)", "Suma Pesas(g)", "Pesas", "d1", "d2", "Error Abs(g)", "Error Rel(%)", "Estado"];
    const rows = state.balanza.trials.map(t => [
        t.ensayo, 
        t.tipo, 
        formatNumberForCSV(t.trueM, 2), 
        formatNumberForCSV(t.apparentM, 2), 
        formatNumberForCSV(t.med, 2), 
        formatNumberForCSV(t.sumP, 2), 
        `"${t.pesas}"`, 
        formatNumberForCSV(t.d1, 4), 
        formatNumberForCSV(t.d2, 4), 
        formatNumberForCSV(t.ea, 2), 
        formatNumberForCSV(t.er, 2), 
        t.estado
    ]);
    exportCSV(`balanza_serie_${state.balanza.sampleId}.csv`, headers, rows);
}

// ==========================================
// 7. MÓDULO: PROPAGACIÓN DE ERRORES
// ==========================================
function changePropModule() {
    const mod = document.getElementById('prop-module').value;
    state.propagacion.module = mod;
    const container = document.getElementById('prop-inputs');
    container.innerHTML = '';
    
    const inputs = {
        area: [ {id:'L', label:'Largo (L)', val:10, unit:'cm'}, {id:'W', label:'Ancho (W)', val:5, unit:'cm'} ],
        'vol-prisma': [ {id:'L', label:'Largo (L)', val:10, unit:'cm'}, {id:'W', label:'Ancho (W)', val:5, unit:'cm'}, {id:'H', label:'Alto (H)', val:8, unit:'cm'} ],
        'vol-cilindro': [ {id:'R', label:'Radio (r)', val:3, unit:'cm'}, {id:'H', label:'Altura (h)', val:10, unit:'cm'} ],
        'vol-esfera': [ {id:'R', label:'Radio (r)', val:5, unit:'cm'} ]
    };

    inputs[mod].forEach(inp => {
        container.innerHTML += `
            <div class="control-group">
                <div class="label-row"><label>${inp.label}</label><span class="unit">${inp.unit}</span></div>
                <input type="number" id="prop-val-${inp.id}" value="${inp.val}" step="0.1" onchange="updatePropBase()">
                <div class="label-row" style="margin-top:0.5rem;"><label>Incertidumbre Δ${inp.id}</label></div>
                <input type="number" id="prop-err-${inp.id}" value="${(inp.val*0.02).toFixed(2)}" step="0.01" onchange="updatePropBase()">
            </div>
        `;
    });

    state.propagacion.trials = [];
    updatePropBase();
}

function updatePropBase() {
    const mod = state.propagacion.module;
    const getVal = id => parseFloat(document.getElementById(`prop-val-${id}`)?.value || 0);
    const getErr = id => parseFloat(document.getElementById(`prop-err-${id}`)?.value || 0);

    let trueZ = 0;
    let deltaZ = 0;
    let unit = "cm³";

    if (mod === 'area') {
        const L = getVal('L'), W = getVal('W'), dL = getErr('L'), dW = getErr('W');
        trueZ = L * W;
        deltaZ = Math.sqrt( Math.pow(W*dL, 2) + Math.pow(L*dW, 2) );
        unit = "cm²";
        drawPropShape('rect', {L, W});
    } else if (mod === 'vol-prisma') {
        const L = getVal('L'), W = getVal('W'), H = getVal('H'), dL = getErr('L'), dW = getErr('W'), dH = getErr('H');
        trueZ = L * W * H;
        deltaZ = trueZ * Math.sqrt( Math.pow(dL/L, 2) + Math.pow(dW/W, 2) + Math.pow(dH/H, 2) );
        drawPropShape('prisma', {L, W, H});
    } else if (mod === 'vol-cilindro') {
        const r = getVal('R'), h = getVal('H'), dr = getErr('R'), dh = getErr('H');
        trueZ = Math.PI * r * r * h;
        deltaZ = trueZ * Math.sqrt( Math.pow(2*dr/r, 2) + Math.pow(dh/h, 2) );
        drawPropShape('cilindro', {r, h});
    } else if (mod === 'vol-esfera') {
        const r = getVal('R'), dr = getErr('R');
        trueZ = (4/3) * Math.PI * Math.pow(r, 3);
        deltaZ = trueZ * (3 * dr / r);
        drawPropShape('esfera', {r});
    }

    state.propagacion.results = { trueZ, deltaZ, unit };
    document.getElementById('res-prop-true').innerText = format(trueZ, 2);
    document.getElementById('res-prop-delta').innerText = format(deltaZ, 2);
    document.querySelectorAll('[id^="res-prop-unit"]').forEach(el => el.innerText = unit);
    
    updateContributionBars();
}

function simulateProp(n) {
    const mod = state.propagacion.module;
    const getVal = id => parseFloat(document.getElementById(`prop-val-${id}`)?.value || 0);
    const getErr = id => parseFloat(document.getElementById(`prop-err-${id}`)?.value || 0);
    const results = state.propagacion.results;
    
    const type = (n === 1) ? "Manual" : "Demo";

    for(let i=0; i<n; i++) {
        let trial = {
            ensayo: state.propagacion.trials.length + 1,
            tipo: type,
            modulo: mod,
            variables: {},
            trueZ: results.trueZ,
            deltaZ: results.deltaZ,
            unit: results.unit
        };

        let z = 0;
        if (mod === 'area') {
            const L = stats.gaussianRandom(getVal('L'), getErr('L'));
            const W = stats.gaussianRandom(getVal('W'), getErr('W'));
            trial.variables = { L, W };
            z = L * W;
        } else if (mod === 'vol-prisma') {
            const L = stats.gaussianRandom(getVal('L'), getErr('L'));
            const W = stats.gaussianRandom(getVal('W'), getErr('W'));
            const H = stats.gaussianRandom(getVal('H'), getErr('H'));
            trial.variables = { L, W, H };
            z = L * W * H;
        } else if (mod === 'vol-cilindro') {
            const r = stats.gaussianRandom(getVal('R'), getErr('R'));
            const h = stats.gaussianRandom(getVal('H'), getErr('H'));
            trial.variables = { R: r, H: h };
            z = Math.PI * r * r * h;
        } else if (mod === 'vol-esfera') {
            const r = stats.gaussianRandom(getVal('R'), getErr('R'));
            trial.variables = { R: r };
            z = (4/3) * Math.PI * Math.pow(r, 3);
        }
        
        trial.calculatedZ = z;
        trial.errorAbs = z - results.trueZ;
        trial.errorRel = Math.abs(trial.errorAbs / results.trueZ) * 100;
        
        state.propagacion.trials.push(trial);
    }

    refreshPropagacionUI();
}

function refreshPropagacionUI() {
    const trials = state.propagacion.trials;
    const values = trials.map(t => t.calculatedZ);
    
    if (values.length > 0) {
        const mean = stats.mean(values);
        const std = stats.sampleStd(values);
        document.getElementById('res-prop-mean').innerText = format(mean, 2);
        document.getElementById('res-prop-std').innerText = format(std, 2);
        drawHistogram('prop-hist-svg', values, state.propagacion.results.trueZ, mean);
    } else {
        document.getElementById('res-prop-mean').innerText = "0.00";
        document.getElementById('res-prop-std').innerText = "0.00";
        const svg = document.getElementById('prop-hist-svg');
        if(svg) svg.innerHTML = '';
    }

    renderPropagacionTable();
}

function renderPropagacionTable() {
    const tbody = document.getElementById('prop-table-body');
    const note = document.getElementById('prop-table-note');
    if (!tbody) return;
    tbody.innerHTML = '';

    const trials = state.propagacion.trials;
    const total = trials.length;
    const limit = PROP_TABLE_VISIBLE_LIMIT;
    const startIdx = Math.max(0, total - limit);
    const visibleTrials = trials.slice(startIdx).reverse(); // Recientes arriba

    if (note) {
        note.innerText = total > limit ? `Mostrando últimos ${limit} de ${total} ensayos` : "";
    }

    const fragment = document.createDocumentFragment();
    visibleTrials.forEach((t, i) => {
        const row = document.createElement('tr');
        
        // Variables string
        let varStr = "";
        if (t.modulo === 'area') varStr = `L=${format(t.variables.L,2)}; W=${format(t.variables.W,2)}`;
        else if (t.modulo === 'vol-prisma') varStr = `L=${format(t.variables.L,2)}; W=${format(t.variables.W,2)}; H=${format(t.variables.H,2)}`;
        else if (t.modulo === 'vol-cilindro') varStr = `r=${format(t.variables.R,2)}; h=${format(t.variables.H,2)}`;
        else if (t.modulo === 'vol-esfera') varStr = `r=${format(t.variables.R,2)}`;

        const actualIdx = total - 1 - i; // Índice real en el array state.propagacion.trials

        row.innerHTML = `
            <td>${t.ensayo}</td>
            <td><span class="badge ${t.tipo === 'Manual' ? 'badge-manual' : 'badge-demo'}">${t.tipo}</span></td>
            <td style="font-size:0.7rem;">${t.modulo}</td>
            <td style="font-size:0.7rem; color:var(--text-secondary);">${varStr}</td>
            <td>${format(t.trueZ, 2)}</td>
            <td style="font-weight:700;">${format(t.calculatedZ, 2)}</td>
            <td>${format(t.deltaZ, 2)}</td>
            <td style="color:${t.errorAbs > 0 ? 'var(--accent-red)' : 'var(--accent-orange)'}">${format(t.errorAbs, 2)}</td>
            <td>${format(t.errorRel, 2)}%</td>
            <td><button class="btn-danger-small" onclick="deletePropTrial(${actualIdx})">Eliminar</button></td>
        `;
        fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
}

function deletePropTrial(index) {
    state.propagacion.trials.splice(index, 1);
    // Renumerar
    state.propagacion.trials.forEach((t, i) => t.ensayo = i + 1);
    refreshPropagacionUI();
}

function exportPropagacionCSV() {
    const headers = ["Ensayo", "Tipo", "Modulo", "L", "W", "H", "R", "Valor Verdadero", "Valor Calculado", "Incertidumbre Propagada", "Error Absoluto", "Error Relativo %", "Unidad"];
    const rows = state.propagacion.trials.map(t => [
        t.ensayo, 
        t.tipo, 
        t.modulo, 
        formatNumberForCSV(t.variables.L, 4), 
        formatNumberForCSV(t.variables.W, 4), 
        formatNumberForCSV(t.variables.H, 4), 
        formatNumberForCSV(t.variables.R, 4), 
        formatNumberForCSV(t.trueZ, 4), 
        formatNumberForCSV(t.calculatedZ, 4), 
        formatNumberForCSV(t.deltaZ, 4), 
        formatNumberForCSV(t.errorAbs, 4), 
        formatNumberForCSV(t.errorRel, 2), 
        t.unit
    ]);
    exportCSV('propagacion_errores_experimento.csv', headers, rows);
}

function updateContributionBars() {
    const mod = state.propagacion.module;
    const container = document.getElementById('prop-contribution-bars');
    container.innerHTML = '';
    
    const getVal = id => parseFloat(document.getElementById(`prop-val-${id}`)?.value || 1);
    const getErr = id => parseFloat(document.getElementById(`prop-err-${id}`)?.value || 0);

    let contributions = [];
    if (mod === 'area') {
        contributions = [ {id:'L', val: Math.pow(getVal('W')*getErr('L'), 2)}, {id:'W', val: Math.pow(getVal('L')*getErr('W'), 2)} ];
    } else if (mod === 'vol-prisma') {
        const v = getVal('L')*getVal('W')*getVal('H');
        contributions = [ 
            {id:'L', val: Math.pow(v*getErr('L')/getVal('L'), 2)}, 
            {id:'W', val: Math.pow(v*getErr('W')/getVal('W'), 2)},
            {id:'H', val: Math.pow(v*getErr('H')/getVal('H'), 2)} 
        ];
    } else if (mod === 'vol-cilindro') {
        const v = Math.PI*Math.pow(getVal('R'),2)*getVal('H');
        contributions = [ 
            {id:'R', val: Math.pow(v*2*getErr('R')/getVal('R'), 2)}, 
            {id:'H', val: Math.pow(v*getErr('H')/getVal('H'), 2)} 
        ];
    } else if (mod === 'vol-esfera') {
        contributions = [ {id:'R', val: 1} ]; // Solo una variable
    }

    const total = contributions.reduce((a, b) => a + b.val, 0);
    contributions.forEach(c => {
        const pct = (c.val / total) * 100;
        container.innerHTML += `
            <div>
                <div class="label-row"><span>Aporte de ${c.id}</span><span>${pct.toFixed(1)}%</span></div>
                <div style="height:8px; background:var(--bg-main); border-radius:4px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:var(--accent-purple);"></div>
                </div>
            </div>
        `;
    });
}

function drawPropShape(type, params) {
    const svg = document.getElementById('prop-shape-svg');
    if (!svg) return;
    svg.innerHTML = '';
    
    // Coordenadas fijas basadas en el viewBox 600x200
    const cx = 300, cy = 100;
    const strokeColor = "var(--accent-blue)";
    const textColor = "var(--text-secondary)";
    const dimColor = "var(--accent-purple)";

    if (type === 'rect') {
        const w = Math.min(params.L * 15, 250), h = Math.min(params.W * 15, 120);
        const x = cx - w/2, y = cy - h/2;
        
        // Rectángulo
        svg.innerHTML += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(56,189,248,0.05)" stroke="${strokeColor}" stroke-width="2" />`;
        
        // Dimensiones
        svg.innerHTML += `<line x1="${x}" y1="${y + h + 15}" x2="${x + w}" y2="${y + h + 15}" stroke="${dimColor}" stroke-width="1" stroke-dasharray="2" />`;
        svg.innerHTML += `<text x="${cx}" y="${y + h + 30}" text-anchor="middle" fill="${textColor}" font-size="12">Largo (L)</text>`;
        
        svg.innerHTML += `<line x1="${x - 15}" y1="${y}" x2="${x - 15}" y2="${y + h}" stroke="${dimColor}" stroke-width="1" stroke-dasharray="2" />`;
        svg.innerHTML += `<text x="${x - 25}" y="${cy}" text-anchor="middle" fill="${textColor}" font-size="12" transform="rotate(-90, ${x-25}, ${cy})">Ancho (W)</text>`;
        
    } else if (type === 'prisma') {
        const w = 120, h = 80, d = 40;
        const x = cx - w/2 - d/2, y = cy - h/2 + d/2;
        
        // Cara frontal
        svg.innerHTML += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${strokeColor}" stroke-width="2" />`;
        // Cara superior
        svg.innerHTML += `<path d="M${x} ${y} L${x+d} ${y-d} L${x+w+d} ${y-d} L${x+w} ${y}" fill="none" stroke="${strokeColor}" stroke-width="1.5" />`;
        // Cara lateral
        svg.innerHTML += `<path d="M${x+w} ${y} L${x+w+d} ${y-d} L${x+w+d} ${y+h-d} L${x+w} ${y+h}" fill="none" stroke="${strokeColor}" stroke-width="1.5" />`;
        
        // Etiquetas
        svg.innerHTML += `<text x="${x + w/2}" y="${y + h + 20}" text-anchor="middle" fill="${textColor}" font-size="11">L</text>`;
        svg.innerHTML += `<text x="${x + w + 15}" y="${y + h/2}" text-anchor="start" fill="${textColor}" font-size="11">W</text>`;
        svg.innerHTML += `<text x="${x - 15}" y="${y + h/2}" text-anchor="end" fill="${textColor}" font-size="11">H</text>`;
        
    } else if (type === 'cilindro') {
        const r = 40, h = 100;
        svg.innerHTML += `<ellipse cx="${cx}" cy="${cy-h/2}" rx="${r}" ry="15" fill="none" stroke="${strokeColor}" stroke-width="2" />`;
        svg.innerHTML += `<ellipse cx="${cx}" cy="${cy+h/2}" rx="${r}" ry="15" fill="none" stroke="${strokeColor}" stroke-width="1.5" />`;
        svg.innerHTML += `<line x1="${cx-r}" y1="${cy-h/2}" x2="${cx-r}" y2="${cy+h/2}" stroke="${strokeColor}" stroke-width="2" />`;
        svg.innerHTML += `<line x1="${cx+r}" y1="${cy-h/2}" x2="${cx+r}" y2="${cy+h/2}" stroke="${strokeColor}" stroke-width="2" />`;
        
        // Etiquetas
        svg.innerHTML += `<line x1="${cx}" y1="${cy-h/2}" x2="${cx+r}" y2="${cy-h/2}" stroke="${dimColor}" stroke-width="1" stroke-dasharray="2" />`;
        svg.innerHTML += `<text x="${cx + r/2}" y="${cy-h/2 - 5}" text-anchor="middle" fill="${textColor}" font-size="11">r</text>`;
        svg.innerHTML += `<text x="${cx - r - 15}" y="${cy}" text-anchor="end" fill="${textColor}" font-size="11">h</text>`;
        
    } else if (type === 'esfera') {
        const r = 60;
        svg.innerHTML += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(56,189,248,0.05)" stroke="${strokeColor}" stroke-width="2" />`;
        svg.innerHTML += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r/3}" fill="none" stroke="${strokeColor}" stroke-width="1" opacity="0.4" stroke-dasharray="4" />`;
        
        // Radio
        svg.innerHTML += `<line x1="${cx}" y1="${cy}" x2="${cx + r*0.7}" y2="${cy - r*0.7}" stroke="${dimColor}" stroke-width="1.5" />`;
        svg.innerHTML += `<text x="${cx + r*0.4}" y="${cy - r*0.4 - 5}" text-anchor="middle" fill="${textColor}" font-size="12">r</text>`;
    }
}

function resetPropagacion() {
    state.propagacion.trials = [];
    document.getElementById('res-prop-mean').innerText = "0.00";
    document.getElementById('res-prop-std').innerText = "0.00";
    const hist = document.getElementById('prop-hist-svg');
    if(hist) hist.innerHTML = '';
    const tbody = document.getElementById('prop-table-body');
    if(tbody) tbody.innerHTML = '';
    const note = document.getElementById('prop-table-note');
    if(note) note.innerText = '';
}

// ==========================================
// 8. HELPERS
// ==========================================
function addTableRow(bodyId, cells) {
    const body = document.getElementById(bodyId);
    const row = document.createElement('tr');
    cells.forEach(c => {
        const td = document.createElement('td');
        td.innerHTML = c;
        row.appendChild(td);
    });
    body.insertBefore(row, body.firstChild);
}

// ==========================================
// 9. DADOS Y PROBABILIDAD EXPERIMENTAL
// ==========================================
const dadosModule = (() => {
function resetDadosState() {
    const dadosState = state.dados;
    dadosState.totalRolls = 0;
    dadosState.redCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dadosState.blackCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dadosState.sumCounts = Array(13).fill(0);
    dadosState.combinations = {};
    dadosState.isRolling = false;

    for (let r = 1; r <= 6; r++) {
        for (let b = 1; b <= 6; b++) {
            dadosState.combinations[`r${r}b${b}`] = 0;
        }
    }
}

function getDadosElements() {
    return {
        dieRed: document.getElementById('dados-die-red'),
        dieBlack: document.getElementById('dados-die-black'),
        btnRoll: document.getElementById('dados-btn-roll'),
        btnRoll10: document.getElementById('dados-btn-roll-10'),
        btnRoll100: document.getElementById('dados-btn-roll-100'),
        btnRoll1000: document.getElementById('dados-btn-roll-1000'),
        btnReset: document.getElementById('dados-btn-reset'),
        totalRollsSpan: document.getElementById('dados-total-rolls'),
        lastSumSpan: document.getElementById('dados-last-sum'),
        histRed: document.getElementById('dados-histogram-red'),
        histBlack: document.getElementById('dados-histogram-black'),
        statsBody: document.getElementById('dados-stats-body'),
        canvas: document.getElementById('dados-sum-chart'),
        matrixGrid: document.getElementById('dados-combination-matrix'),
        histAdvanced: document.getElementById('dados-sum-histogram-advanced')
    };
}

function playDadosSound() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    if (!state.dados.audioCtx) {
        state.dados.audioCtx = new AudioCtor();
    }

    const audioCtx = state.dados.audioCtx;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

function initDadosUI() {
    const elements = getDadosElements();
    if (!elements.histRed || !elements.histBlack || !elements.statsBody) return;

    [elements.histRed, elements.histBlack].forEach(hist => {
        hist.innerHTML = '';
        for (let i = 1; i <= 6; i++) {
            const col = document.createElement('div');
            col.className = 'dados-hist-column';
            col.id = `${hist.id}-col-${i}`;

            const label = document.createElement('span');
            label.className = 'dados-hist-label';
            label.innerText = i;
            col.appendChild(label);

            const bar = document.createElement('div');
            bar.className = 'dados-hist-bar';
            bar.id = `${hist.id}-bar-${i}`;

            const valLabel = document.createElement('span');
            valLabel.className = 'dados-bar-value';
            valLabel.id = `${hist.id}-val-${i}`;
            valLabel.innerText = '0';
            bar.appendChild(valLabel);

            col.appendChild(bar);
            hist.appendChild(col);
        }

        const yAxis = document.createElement('div');
        yAxis.className = 'dados-y-axis-grid';
        yAxis.id = `${hist.id}-y-axis`;
        hist.appendChild(yAxis);
    });

    elements.statsBody.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${i}</td>
            <td id="dados-red-count-${i}">0</td>
            <td id="dados-red-pct-${i}">0%</td>
            <td id="dados-black-count-${i}">0</td>
            <td id="dados-black-pct-${i}">0%</td>
        `;
        elements.statsBody.appendChild(row);
    }

    drawDadosDots(elements);
    initDadosAdvancedStats(elements);
    initDadosTooltip(elements);
    updateDadosUI();
}

function initDadosTooltip(elements) {
    let tooltip = document.getElementById('dados-heatmap-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'dados-heatmap-tooltip';
        document.body.appendChild(tooltip);
    }
    elements.tooltip = tooltip;
}

function initDadosAdvancedStats(elements) {
    elements.matrixGrid.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'dados-matrix-label';
    elements.matrixGrid.appendChild(corner);

    for (let b = 1; b <= 6; b++) {
        const label = document.createElement('div');
        label.className = 'dados-matrix-label';
        label.innerText = `N${b}`;
        elements.matrixGrid.appendChild(label);
    }

    for (let r = 1; r <= 6; r++) {
        const label = document.createElement('div');
        label.className = 'dados-matrix-label';
        label.innerText = `R${r}`;
        elements.matrixGrid.appendChild(label);

        for (let b = 1; b <= 6; b++) {
            const cell = document.createElement('div');
            cell.className = 'dados-matrix-cell';
            cell.id = `dados-cell-r${r}b${b}`;
            cell.title = `Rojo: ${r}, Negro: ${b}`;
            elements.matrixGrid.appendChild(cell);
        }
    }

    elements.histAdvanced.innerHTML = '';
    for (let s = 2; s <= 12; s++) {
        const col = document.createElement('div');
        col.className = 'dados-hist-column';

        const label = document.createElement('span');
        label.className = 'dados-hist-label';
        label.innerText = s;
        col.appendChild(label);

        const bar = document.createElement('div');
        bar.className = 'dados-hist-bar';
        bar.id = `dados-sum-bar-${s}`;

        const valLabel = document.createElement('span');
        valLabel.className = 'dados-bar-value';
        valLabel.id = `dados-sum-val-${s}`;
        valLabel.innerText = '0';
        bar.appendChild(valLabel);

        col.appendChild(bar);
        elements.histAdvanced.appendChild(col);
    }

    const yAxis = document.createElement('div');
    yAxis.className = 'dados-y-axis-grid';
    yAxis.id = 'dados-advanced-y-axis';
    elements.histAdvanced.appendChild(yAxis);
}

function drawDadosDots(elements) {
    const pipPositions = {
        1: [5],
        2: [1, 9],
        3: [1, 5, 9],
        4: [1, 3, 7, 9],
        5: [1, 3, 5, 7, 9],
        6: [1, 4, 7, 3, 6, 9]
    };

    [elements.dieRed, elements.dieBlack].forEach(die => {
        const faces = ['front', 'back', 'right', 'left', 'top', 'bottom'];
        const faceValues = [1, 6, 3, 4, 5, 2];

        faces.forEach((faceClass, index) => {
            const face = die.querySelector(`.dados-${faceClass}`);
            const val = faceValues[index];
            face.innerHTML = '';

            for (let i = 1; i <= 9; i++) {
                const slot = document.createElement('div');
                if (pipPositions[val].includes(i)) {
                    const pip = document.createElement('div');
                    pip.className = 'dados-pip';
                    slot.appendChild(pip);
                }
                face.appendChild(slot);
            }
        });
    });
}

function getRandomDieValue() {
    return Math.floor(Math.random() * 6) + 1;
}

function rollDados(silent = false) {
    const dadosState = state.dados;
    const valRed = getRandomDieValue();
    const valBlack = getRandomDieValue();
    const sum = valRed + valBlack;

    dadosState.totalRolls++;
    dadosState.redCounts[valRed]++;
    dadosState.blackCounts[valBlack]++;
    dadosState.sumCounts[sum]++;
    dadosState.combinations[`r${valRed}b${valBlack}`]++;

    if (!silent) {
        pulseDadosMatrixCell(valRed, valBlack);
        updateDadosUI(valRed, valBlack, sum);
        animateDados(valRed, valBlack);
        playDadosSound();
    }
}

function rollDadosMultiple(count) {
    const dadosState = state.dados;
    const elements = getDadosElements();
    if (dadosState.isRolling) return;

    dadosState.isRolling = true;
    elements.dieRed.parentElement.classList.add('dados-rolling');
    elements.dieBlack.parentElement.classList.add('dados-rolling');
    playDadosSound();

    setTimeout(() => {
        for (let i = 0; i < count; i++) {
            rollDados(true);
        }

        updateDadosUI();
        animateDados(getRandomDieValue(), getRandomDieValue());
        elements.dieRed.parentElement.classList.remove('dados-rolling');
        elements.dieBlack.parentElement.classList.remove('dados-rolling');
        dadosState.isRolling = false;
    }, 420);
}

function rollDadosChunked(total) {
    const dadosState = state.dados;
    const elements = getDadosElements();
    if (dadosState.isRolling) return;

    dadosState.isRolling = true;
    elements.dieRed.parentElement.classList.add('dados-rolling');
    elements.dieBlack.parentElement.classList.add('dados-rolling');
    playDadosSound();

    let count = 0;
    const chunkSize = 50;

    function process() {
        const limit = Math.min(chunkSize, total - count);
        for (let i = 0; i < limit; i++) {
            rollDados(true);
            count++;
        }

        if (count < total) {
            requestAnimationFrame(process);
        } else {
            updateDadosUI();
            animateDados(getRandomDieValue(), getRandomDieValue());
            elements.dieRed.parentElement.classList.remove('dados-rolling');
            elements.dieBlack.parentElement.classList.remove('dados-rolling');
            dadosState.isRolling = false;
        }
    }

    requestAnimationFrame(process);
}

function updateDadosUI(vRed, vBlack, sum) {
    const dadosState = state.dados;
    const elements = getDadosElements();
    if (!elements.totalRollsSpan) return;

    elements.totalRollsSpan.innerText = dadosState.totalRolls;
    if (sum) elements.lastSumSpan.innerText = sum;

    for (let i = 1; i <= 6; i++) {
        const rCount = dadosState.redCounts[i];
        const bCount = dadosState.blackCounts[i];
        const rPct = dadosState.totalRolls > 0 ? ((rCount / dadosState.totalRolls) * 100).toFixed(1) : 0;
        const bPct = dadosState.totalRolls > 0 ? ((bCount / dadosState.totalRolls) * 100).toFixed(1) : 0;

        document.getElementById(`dados-red-count-${i}`).innerText = rCount;
        document.getElementById(`dados-red-pct-${i}`).innerText = `${rPct}%`;
        document.getElementById(`dados-black-count-${i}`).innerText = bCount;
        document.getElementById(`dados-black-pct-${i}`).innerText = `${bPct}%`;
    }

    refreshDadosHistograms();
    refreshDadosAdvancedStats();
    renderDadosChart();
}

function pulseDadosMatrixCell(r, b) {
    const cell = document.getElementById(`dados-cell-r${r}b${b}`);
    if (!cell) return;

    cell.classList.remove('dados-cell-pulse');
    void cell.offsetWidth;
    cell.classList.add('dados-cell-pulse');
}

function refreshDadosAdvancedStats() {
    const dadosState = state.dados;
    const maxSum = Math.max(...dadosState.sumCounts, 1);
    const yScale = getDadosNiceMax(maxSum);

    for (let r = 1; r <= 6; r++) {
        for (let b = 1; b <= 6; b++) {
            const count = dadosState.combinations[`r${r}b${b}`] || 0;
            const cell = document.getElementById(`dados-cell-r${r}b${b}`);
            if (!cell) continue;

            const prob = dadosState.totalRolls > 0 ? (count / dadosState.totalRolls) : 0;
            const theoreticalProb = 1 / 36;
            const dev = prob - theoreticalProb;
            const pct = (prob * 100).toFixed(2);
            const devPct = (dev * 100).toFixed(2);
            const devPrefix = dev >= 0 ? '+' : '';

            cell.style.backgroundColor = getDadosHeatmapColor(prob);
            cell.style.color = prob > 0.022 ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.9)';
            cell.innerHTML = `
                <span class="dados-cell-count">${count}</span>
                <span class="dados-cell-pct">${pct}%</span>
                <span class="dados-cell-dev">${devPrefix}${devPct}%</span>
            `;
            cell.setAttribute('data-info', `Combinación: <span class="dados-tooltip-val">R${r} + N${b}</span><br>Frecuencia: <span class="dados-tooltip-val">${count}</span><br>Probabilidad: <span class="dados-tooltip-val">${pct}%</span><br>Desviación: <span class="dados-tooltip-val">${devPrefix}${devPct}%</span>`);
        }
    }

    for (let s = 2; s <= 12; s++) {
        const bar = document.getElementById(`dados-sum-bar-${s}`);
        const valLabel = document.getElementById(`dados-sum-val-${s}`);
        if (!bar || !valLabel) continue;

        const total = dadosState.sumCounts[s];
        const heightPct = (total / yScale) * 100;
        bar.style.height = `${heightPct}%`;
        valLabel.innerText = total;
        bar.querySelectorAll('.dados-sum-segment').forEach(seg => seg.remove());

        for (let r = 1; r <= 6; r++) {
            const b = s - r;
            if (b >= 1 && b <= 6 && total > 0) {
                const combCount = dadosState.combinations[`r${r}b${b}`] || 0;
                if (combCount > 0) {
                    const segment = document.createElement('div');
                    segment.className = `dados-sum-segment dados-sum-segment-r${r}`;
                    const pctWithinSum = (combCount / total) * 100;
                    const pctGlobal = dadosState.totalRolls > 0 ? (combCount / dadosState.totalRolls) * 100 : 0;
                    segment.style.height = `${pctWithinSum}%`;
                    segment.title = `Rojo ${r} + Negro ${b}: ${combCount}`;
                    segment.setAttribute('data-info', `Suma: <span class="dados-tooltip-val">${s}</span><br>Combinación: <span class="dados-tooltip-val">Rojo ${r} + Negro ${b}</span><br>Frecuencia: <span class="dados-tooltip-val">${combCount}</span><br>Dentro de suma ${s}: <span class="dados-tooltip-val">${pctWithinSum.toFixed(1)}%</span><br>Sobre total: <span class="dados-tooltip-val">${pctGlobal.toFixed(2)}%</span>`);
                    segment.setAttribute('data-suma', s);
                    segment.setAttribute('data-rojo', r);
                    segment.setAttribute('data-negro', b);
                    segment.setAttribute('data-count', combCount);
                    bar.appendChild(segment);
                }
            }
        }
    }

    updateDadosYAxis('dados-advanced-y-axis', yScale);
}

function getDadosHeatmapColor(prob) {
    if (prob === 0) return 'rgba(15, 23, 42, 0.5)';

    const targetPct = (1 / 36) * 100;
    const diff = (prob * 100) - targetPct;
    let hue;

    if (diff <= -0.5) {
        hue = 220;
    } else if (diff < 0) {
        hue = 120 + (Math.abs(diff) / 0.5) * 100;
    } else if (diff === 0) {
        hue = 120;
    } else if (diff < 0.5) {
        hue = 120 - (diff / 0.5) * 120;
    } else {
        hue = 0;
    }

    const light = 45 + (Math.abs(diff) > 0.1 ? 5 : 15);
    return `hsla(${hue}, 78%, ${light}%, 0.85)`;
}

function refreshDadosHistograms() {
    const dadosState = state.dados;
    const values = [...Object.values(dadosState.redCounts), ...Object.values(dadosState.blackCounts)];
    const yScale = getDadosNiceMax(Math.max(...values, 1));
    let segmentHeight = 10;

    if (yScale > 15) segmentHeight = 8;
    if (yScale > 30) segmentHeight = 6;
    if (yScale > 50) segmentHeight = 4;
    if (yScale > 100) segmentHeight = 3;
    if (yScale > 200) segmentHeight = 2;

    for (let i = 1; i <= 6; i++) {
        updateDadosBar('dados-histogram-red', i, dadosState.redCounts[i], yScale, segmentHeight);
        updateDadosBar('dados-histogram-black', i, dadosState.blackCounts[i], yScale, segmentHeight);
    }

    updateDadosYAxis('dados-histogram-red-y-axis', yScale);
    updateDadosYAxis('dados-histogram-black-y-axis', yScale);
}

function getDadosNiceMax(max) {
    if (max <= 10) return 10;
    if (max <= 20) return 20;
    if (max <= 50) return 50;
    if (max <= 100) return 100;
    const step = max > 500 ? 100 : 50;
    return Math.ceil(max / step) * step;
}

function updateDadosYAxis(axisId, yScale) {
    const yAxis = document.getElementById(axisId);
    if (!yAxis) return;

    yAxis.innerHTML = '';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const val = Math.round((yScale / steps) * i);
        const bottomPct = (i / steps) * 100;
        const line = document.createElement('div');
        line.className = 'dados-grid-line';
        line.style.bottom = `${bottomPct}%`;

        const label = document.createElement('span');
        label.className = 'dados-grid-label';
        label.innerText = val;
        line.appendChild(label);
        yAxis.appendChild(line);
    }
}

function updateDadosBar(histId, num, count, yScale, segmentHeight) {
    const bar = document.getElementById(`${histId}-bar-${num}`);
    const valLabel = document.getElementById(`${histId}-val-${num}`);
    if (!bar || !valLabel) return;

    let heightPct = (count / yScale) * 100;
    if (count > 0 && heightPct < 2) heightPct = 2;

    bar.style.height = `${heightPct}%`;
    bar.style.backgroundSize = `100% ${segmentHeight}px`;
    valLabel.innerText = count;
}

function animateDados(vRed, vBlack) {
    const elements = getDadosElements();
    const angles = {
        1: { x: 0, y: 0 },
        6: { x: 0, y: 180 },
        3: { x: 0, y: -90 },
        4: { x: 0, y: 90 },
        5: { x: -90, y: 0 },
        2: { x: 90, y: 0 }
    };

    const aRed = angles[vRed];
    const aBlack = angles[vBlack];
    const extraTurns = 720;
    elements.dieRed.style.transform = `rotateX(${aRed.x + extraTurns}deg) rotateY(${aRed.y + extraTurns}deg)`;
    elements.dieBlack.style.transform = `rotateX(${aBlack.x + extraTurns}deg) rotateY(${aBlack.y + extraTurns}deg)`;
}

function renderDadosChart() {
    const elements = getDadosElements();
    if (!elements.canvas) return;

    const ctx = elements.canvas.getContext('2d');
    const width = elements.canvas.offsetWidth || 400;
    const height = elements.canvas.offsetHeight || 240;
    elements.canvas.width = width;
    elements.canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = chartWidth / 11;
    const maxVal = Math.max(...state.dados.sumCounts, 1);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    for (let i = 2; i <= 12; i++) {
        const count = state.dados.sumCounts[i];
        const barHeight = (count / maxVal) * chartHeight;
        const x = padding + (i - 2) * barWidth + 5;
        const y = height - padding - barHeight;
        const gradient = ctx.createLinearGradient(0, y, 0, height - padding);
        gradient.addColorStop(0, '#38bdf8');
        gradient.addColorStop(1, '#6366f1');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(barWidth - 10, 4), barHeight, 5);
        ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(i, x + (barWidth - 10) / 2, height - padding + 20);

        if (count > 0) {
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(count, x + (barWidth - 10) / 2, y - 5);
        }
    }
}

function resetDados() {
    resetDadosState();
    const elements = getDadosElements();
    if (elements.totalRollsSpan) elements.totalRollsSpan.innerText = '0';
    if (elements.lastSumSpan) elements.lastSumSpan.innerText = '-';
    initDadosUI();
}

function initDados() {
    if (state.dados.initialized) return;
    resetDadosState();
    initDadosUI();

    const elements = getDadosElements();
    if (!elements.btnRoll) return;

    elements.btnRoll.addEventListener('click', () => {
        if (state.dados.isRolling) return;
        state.dados.isRolling = true;
        elements.dieRed.parentElement.classList.add('dados-rolling');
        elements.dieBlack.parentElement.classList.add('dados-rolling');

        setTimeout(() => {
            rollDados();
            elements.dieRed.parentElement.classList.remove('dados-rolling');
            elements.dieBlack.parentElement.classList.remove('dados-rolling');
            state.dados.isRolling = false;
        }, 520);
    });

    elements.btnRoll10.addEventListener('click', () => rollDadosMultiple(10));
    elements.btnRoll100.addEventListener('click', () => rollDadosMultiple(100));
    elements.btnRoll1000.addEventListener('click', () => rollDadosChunked(1000));
    elements.btnReset.addEventListener('click', resetDados);

    elements.matrixGrid.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.dados-matrix-cell');
        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (cell && tooltip && cell.hasAttribute('data-info')) {
            tooltip.innerHTML = cell.getAttribute('data-info');
            tooltip.style.display = 'block';
        }
    });

    elements.matrixGrid.addEventListener('mousemove', (e) => {
        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (tooltip && tooltip.style.display === 'block') {
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
        }
    });

    elements.matrixGrid.addEventListener('mouseout', () => {
        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    });

    elements.histAdvanced.addEventListener('mouseover', (e) => {
        const segment = e.target.closest('.dados-sum-segment');
        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (segment && tooltip && segment.hasAttribute('data-info')) {
            tooltip.innerHTML = segment.getAttribute('data-info');
            tooltip.style.display = 'block';
        }
    });

    elements.histAdvanced.addEventListener('mousemove', (e) => {
        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (tooltip && tooltip.style.display === 'block') {
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
        }
    });

    elements.histAdvanced.addEventListener('mouseout', (e) => {
        const segment = e.target.closest('.dados-sum-segment');
        if (!segment) return;

        const tooltip = document.getElementById('dados-heatmap-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    });

    window.addEventListener('resize', renderDadosChart);
    state.dados.initialized = true;
}

// ==========================================
// 9. INICIALIZACIÓN
// ==========================================
return {
    init: initDados,
    renderChart: renderDadosChart
};
})();

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    
    // Caída Libre
    document.getElementById('caida-h-slider').addEventListener('input', updateCaidaUI);
    document.getElementById('caida-g-select').addEventListener('change', updateCaidaUI);
    document.getElementById('caida-g-num').addEventListener('input', updateCaidaUI);
    updateCaidaUI();

    // Balanza
    initBalanza();
    document.getElementById('balanza-d1-slider').addEventListener('input', updateBalanzaUI);
    document.getElementById('balanza-d2-slider').addEventListener('input', updateBalanzaUI);
    document.getElementById('balanza-mode-select').addEventListener('change', updateBalanzaUI);
    document.getElementById('balanza-arms-config').addEventListener('change', updateBalanzaUI);
    document.getElementById('balanza-resolution-select').addEventListener('change', updateBalanzaResolution);
    document.getElementById('balanza-sensitivity-select').addEventListener('change', updateBalanzaUI);
    document.getElementById('balanza-zero-slider').addEventListener('input', updateBalanzaUI);
    document.getElementById('balanza-var-slider').addEventListener('input', updateBalanzaUI);
    document.getElementById('balanza-show-mass').addEventListener('change', updateBalanzaUI);

    // Propagación
    changePropModule();

    // Dados y probabilidad experimental
    dadosModule.init();
});
