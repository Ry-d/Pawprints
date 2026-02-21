// PawPrints — Main App Controller
// Manages screen flow, state, and API calls

const APP = {
    currentScreen: 'upload',
    uploadedFile: null,
    previewUrl: null,
    modelUrl: null,
    selectedMaterial: 'abs',
    selectedColor: null,
    selectedFinish: null,
    selectedHeight: 150,
    price: null,
};

// ─── Screen Navigation ───
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${screenId}`);
    if (screen) screen.classList.add('active');
    APP.currentScreen = screenId;
    updateStepIndicator(screenId);
    updateNavStep(screenId);
    window.scrollTo(0, 0);
}

function updateStepIndicator(screenId) {
    const steps = ['upload', 'customise', 'order'];
    const idx = steps.indexOf(screenId);
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
        dot.className = 'step-dot';
        if (i < idx) dot.classList.add('done');
        if (i === idx) dot.classList.add('active');
    });
}

function updateNavStep(screenId) {
    const labels = {
        'upload': 'Step 1 of 3',
        'customise': 'Step 2 of 3',
        'order': 'Step 3 of 3',
        'success': '✓ Complete',
    };
    const el = document.getElementById('nav-step');
    if (el) el.textContent = labels[screenId] || '';
}

// ─── Upload Screen ───
function initUpload() {
    const area = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-input');

    // Click to upload
    area.addEventListener('click', () => fileInput.click());

    // Drag & drop
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // File input change
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // Camera button
    document.getElementById('btn-camera').addEventListener('click', e => {
        e.stopPropagation();
        cameraInput.click();
    });

    cameraInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // Gallery button
    document.getElementById('btn-gallery').addEventListener('click', e => {
        e.stopPropagation();
        fileInput.click();
    });
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file (JPG, PNG, etc.)');
        return;
    }

    APP.uploadedFile = file;
    APP.previewUrl = URL.createObjectURL(file);

    // Show preview
    document.getElementById('preview-img').src = APP.previewUrl;
    document.getElementById('preview-section').style.display = 'block';
    document.getElementById('upload-area').style.display = 'none';
}

function removePhoto() {
    APP.uploadedFile = null;
    APP.previewUrl = null;
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('upload-area').style.display = 'block';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
}

function startProcessing() {
    if (!APP.uploadedFile) return;
    showProcessing('Uploading your photo...', 'This will take a moment');
    uploadAndProcess(APP.uploadedFile);
}

// ─── Processing ───
function showProcessing(title, sub) {
    document.getElementById('processing-text').textContent = title;
    document.getElementById('processing-sub').textContent = sub;
    document.getElementById('processing-overlay').classList.add('active');
    setProgress(0);
}

function hideProcessing() {
    document.getElementById('processing-overlay').classList.remove('active');
}

function setProgress(pct) {
    document.getElementById('progress-fill').style.width = pct + '%';
}

async function uploadAndProcess(file) {
    try {
        // Step 1: Upload
        setProgress(10);
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error('Upload failed');
        const uploadData = await uploadRes.json();

        // Step 2: Generate 3D model
        setProgress(25);
        document.getElementById('processing-text').textContent = 'Removing background...';
        document.getElementById('processing-sub').textContent = 'Isolating your pet';

        const genRes = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: uploadData.path }),
        });
        if (!genRes.ok) throw new Error('Generation failed');
        const genData = await genRes.json();

        // Step 3: Poll for model completion
        if (genData.task_id) {
            document.getElementById('processing-text').textContent = 'Creating 3D model...';
            document.getElementById('processing-sub').textContent = 'This usually takes 2-4 minutes';
            await pollModelStatus(genData.task_id);
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        // Done — go to customise
        setProgress(100);
        hideProcessing();
        initCustomise();
        showScreen('customise');

    } catch (err) {
        hideProcessing();
        console.error('Processing error:', err);
        // Fallback: use demo model
        APP.modelUrl = '/static/model.glb';
        initCustomise();
        showScreen('customise');
    }
}

async function pollModelStatus(taskId) {
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000));
        setProgress(25 + Math.min(i * 0.6, 70));

        try {
            const res = await fetch(`/api/model-status/${taskId}`);
            const data = await res.json();

            if (data.status === 'completed') {
                APP.modelUrl = data.model_url;
                return;
            }
            if (data.status === 'failed') {
                throw new Error('Model generation failed');
            }

            document.getElementById('processing-sub').textContent = 
                `Generating... ${data.progress || Math.round(25 + i * 0.6)}%`;
        } catch (e) {
            // continue polling
        }
    }
    throw new Error('Timeout waiting for model');
}

// ─── Customise Screen ───
function initCustomise() {
    const modelUrl = APP.modelUrl || '/static/model.glb';

    // Init 3D viewer
    const viewerContainer = document.getElementById('viewer-3d');
    viewerContainer.innerHTML = '';
    initViewer('viewer-3d');
    loadModel(modelUrl);

    // Set defaults
    APP.selectedMaterial = 'abs';
    APP.selectedColor = MATERIALS.abs.colors[0];
    APP.selectedFinish = MATERIALS.abs.finishes[0];
    APP.selectedHeight = 150;

    renderMaterials();
    renderOptions();
    updatePrice();
    bindCustomiseEvents();
}

function renderMaterials() {
    const container = document.getElementById('material-grid');
    container.innerHTML = '';

    Object.values(MATERIALS).forEach(mat => {
        const div = document.createElement('div');
        div.className = `material-option ${mat.id === APP.selectedMaterial ? 'selected' : ''}`;
        div.dataset.id = mat.id;
        div.innerHTML = `
            <div class="material-swatch" style="${mat.swatchStyle}"></div>
            <div class="material-info">
                <div class="material-name">${mat.icon} ${mat.name}</div>
                <div class="material-desc">${mat.tagline}</div>
            </div>
            <div class="material-price-tag">${mat.tier}</div>
        `;
        div.addEventListener('click', () => selectMaterial(mat.id));
        container.appendChild(div);
    });
}

function selectMaterial(matId) {
    APP.selectedMaterial = matId;
    const mat = MATERIALS[matId];
    APP.selectedColor = mat.colors[0];
    APP.selectedFinish = mat.finishes[0];

    // Update material selection UI
    document.querySelectorAll('.material-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === matId);
    });

    // Clamp height
    const validation = validateSize(matId, APP.selectedHeight);
    if (!validation.valid && validation.clamped) {
        APP.selectedHeight = validation.clamped;
        document.getElementById('size-slider').value = APP.selectedHeight;
    }

    // Update slider max
    document.getElementById('size-slider').max = mat.maxSize;
    document.getElementById('size-slider').min = mat.minSize;

    renderOptions();
    updateSizeUI();
    updatePrice();
}

function renderOptions() {
    const mat = MATERIALS[APP.selectedMaterial];

    // Colours
    const colorContainer = document.getElementById('color-options');
    colorContainer.innerHTML = '';
    mat.colors.forEach((color, idx) => {
        const dot = document.createElement('div');
        dot.className = `color-dot ${idx === 0 ? 'selected' : ''}`;
        if (color.hex === 'rainbow') {
            dot.classList.add('rainbow');
        } else {
            dot.style.backgroundColor = color.hex;
        }
        dot.title = color.name;
        dot.addEventListener('click', () => {
            APP.selectedColor = color;
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
            dot.classList.add('selected');
            if (color.hex !== 'rainbow') {
                setModelColor(color.hex);
            } else {
                resetModelColor();
            }
        });
        colorContainer.appendChild(dot);
    });

    // Finishes
    const finishContainer = document.getElementById('finish-options');
    finishContainer.innerHTML = '';
    mat.finishes.forEach((finish, idx) => {
        const chip = document.createElement('div');
        chip.className = `finish-chip ${idx === 0 ? 'selected' : ''}`;
        chip.textContent = finish;
        chip.addEventListener('click', () => {
            APP.selectedFinish = finish;
            document.querySelectorAll('.finish-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            updatePrice();
        });
        finishContainer.appendChild(chip);
    });
}

function bindCustomiseEvents() {
    const slider = document.getElementById('size-slider');
    slider.addEventListener('input', () => {
        APP.selectedHeight = parseInt(slider.value);
        updateSizeUI();
        setModelScale(APP.selectedHeight);
        updatePrice();
    });
}

function updateSizeUI() {
    const mat = MATERIALS[APP.selectedMaterial];
    document.getElementById('size-value').textContent = APP.selectedHeight + 'mm';
    document.getElementById('size-min-label').textContent = mat.minSize + 'mm';
    document.getElementById('size-max-label').textContent = mat.maxSize + 'mm';

    const validation = validateSize(APP.selectedMaterial, APP.selectedHeight);
    const warning = document.getElementById('size-warning');
    if (!validation.valid) {
        warning.textContent = '⚠️ ' + validation.message;
        warning.classList.add('visible');
    } else {
        warning.classList.remove('visible');
    }
}

function updatePrice() {
    const result = calculatePrice(APP.selectedMaterial, APP.selectedHeight, APP.selectedFinish);
    if (!result) return;

    APP.price = result;
    document.getElementById('quote-price').textContent = '$' + result.total.toFixed(2) + ' AUD';
    document.getElementById('quote-breakdown').innerHTML = `
        ${MATERIALS[APP.selectedMaterial].name} · ${APP.selectedHeight}mm · ${APP.selectedFinish}<br>
        Manufacturing: $${result.baseCost.toFixed(2)} + Service: $${result.markup.toFixed(2)}
    `;

    const orderBtn = document.getElementById('btn-order');
    const validation = validateSize(APP.selectedMaterial, APP.selectedHeight);
    orderBtn.disabled = !validation.valid;
}

// ─── Order Screen ───
function goToOrder() {
    showScreen('order');
    renderOrderSummary();
}

function renderOrderSummary() {
    const mat = MATERIALS[APP.selectedMaterial];
    document.getElementById('order-material').textContent = mat.name;
    document.getElementById('order-size').textContent = APP.selectedHeight + 'mm';
    document.getElementById('order-color').textContent = APP.selectedColor?.name || 'Default';
    document.getElementById('order-finish').textContent = APP.selectedFinish;
    document.getElementById('order-price').textContent = '$' + APP.price.total.toFixed(2) + ' AUD';
    document.getElementById('order-total').textContent = '$' + APP.price.total.toFixed(2) + ' AUD';
}

async function placeOrder() {
    // For now: demo confirmation. Stripe integration later.
    showScreen('success');
    document.getElementById('success-order-id').textContent = 'PP-' + Date.now().toString(36).toUpperCase();
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    showScreen('upload');
});
