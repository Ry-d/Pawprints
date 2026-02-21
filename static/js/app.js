// PawPrints — Main App Controller

const APP = {
    currentScreen: 'upload',
    productType: null, // 'statue' or 'keyring'
    uploadedFile: null,
    previewUrl: null,
    modelUrl: null,
    selectedMaterial: 'abs',
    selectedColor: null,
    selectedFinish: null,
    selectedHeight: 150,
    price: null,
    activeUploadTarget: null,
    email: null,
    remaining: 3,
};

// ─── Navigation ───
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');
    APP.currentScreen = screenId;

    const steps = ['upload', 'customise', 'order'];
    const idx = steps.indexOf(screenId);
    document.querySelectorAll('.step-dot').forEach((d, i) => {
        d.className = 'step-dot';
        if (i < idx) d.classList.add('done');
        if (i === idx) d.classList.add('active');
    });

    const labels = { upload: 'Step 1 of 3', customise: 'Step 2 of 3', order: 'Step 3 of 3', success: '✓ Complete' };
    document.getElementById('nav-step').textContent = labels[screenId] || '';
    document.getElementById('nav-back').style.display = idx > 0 ? '' : 'none';
    window.scrollTo(0, 0);
}

function goBack() {
    const flow = ['upload', 'customise', 'order'];
    const idx = flow.indexOf(APP.currentScreen);
    if (idx > 0) showScreen(flow[idx - 1]);
}

// ─── Product Selection (Screen 1) ───
function selectProduct(type) {
    APP.productType = type;
    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.product-upload-area').forEach(u => u.style.display = 'none');

    document.getElementById(`card-${type}`).classList.add('selected');
    document.getElementById(`upload-${type}`).style.display = 'block';

    checkUploadReady();
}

function triggerCamera(type) {
    APP.activeUploadTarget = type;
    document.getElementById('camera-input').click();
}

function triggerGallery(type) {
    APP.activeUploadTarget = type;
    document.getElementById('file-input').click();
}

function handleFile(file, target) {
    if (!file || !file.type.startsWith('image/')) return;
    APP.uploadedFile = file;
    APP.previewUrl = URL.createObjectURL(file);

    const img = document.getElementById(`preview-img-${target}`);
    const container = document.getElementById(`preview-${target}`);
    img.src = APP.previewUrl;
    container.style.display = 'block';
    checkUploadReady();
}

function removePhoto(type) {
    APP.uploadedFile = null;
    APP.previewUrl = null;
    document.getElementById(`preview-${type}`).style.display = 'none';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
    checkUploadReady();
}

function checkUploadReady() {
    document.getElementById('btn-continue-upload').disabled = !(APP.productType && APP.uploadedFile);
}

// ─── File Input Listeners ───
document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files.length && APP.activeUploadTarget) handleFile(e.target.files[0], APP.activeUploadTarget);
});
document.getElementById('camera-input').addEventListener('change', e => {
    if (e.target.files.length && APP.activeUploadTarget) handleFile(e.target.files[0], APP.activeUploadTarget);
});

// ─── Processing ───
function startProcessing() {
    if (!APP.uploadedFile) return;

    // Check email
    const email = prompt('Enter your email to get started:');
    if (!email || !email.includes('@')) {
        alert('A valid email is required to generate your 3D model.');
        return;
    }

    APP.email = email;
    showProcessing('Uploading your photo...', 'This will take a moment');
    registerAndProcess(email, APP.uploadedFile);
}

async function registerAndProcess(email, file) {
    try {
        const regRes = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        if (!regRes.ok) {
            const err = await regRes.json();
            throw new Error(err.detail || 'Registration failed');
        }
        const regData = await regRes.json();
        APP.remaining = regData.remaining;
        await uploadAndProcess(file);
    } catch (err) {
        hideProcessing();
        alert(err.message);
    }
}

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
        setProgress(10);
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error('Upload failed');
        const uploadData = await uploadRes.json();

        setProgress(25);
        document.getElementById('processing-text').textContent = 'Removing background...';

        const genRes = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: uploadData.path, product_type: APP.productType }),
        });
        if (!genRes.ok) throw new Error('Generation failed');
        const genData = await genRes.json();

        if (genData.task_id) {
            document.getElementById('processing-text').textContent = 'Creating 3D model...';
            document.getElementById('processing-sub').textContent = 'Usually 2-4 minutes';
            await pollModelStatus(genData.task_id);
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        if (genData.remaining !== undefined) APP.remaining = genData.remaining;

        setProgress(100);
        hideProcessing();
        initCustomise();
        showScreen('customise');
    } catch (err) {
        hideProcessing();
        if (err.message.includes('limit')) {
            alert(err.message);
            return;
        }
        console.error(err);
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
            if (data.status === 'completed') { APP.modelUrl = data.model_url; return; }
            if (data.status === 'failed') throw new Error('Failed');
            document.getElementById('processing-sub').textContent = `Generating... ${data.progress || Math.round(25 + i * 0.6)}%`;
        } catch (e) { /* continue */ }
    }
    throw new Error('Timeout');
}

// ─── Customise (Screen 2) ───
function initCustomise() {
    const modelUrl = APP.modelUrl || '/static/model.glb';
    const container = document.getElementById('viewer-3d');
    // Clear canvas but keep buttons
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) existingCanvas.remove();

    initViewer('viewer-3d');
    loadModel(modelUrl);

    // Set product toggle
    document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === APP.productType);
    });

    // Keyring: lock size
    const isKeyring = APP.productType === 'keyring';
    const sizeCard = document.getElementById('size-card');

    if (isKeyring) {
        APP.selectedHeight = 50;
        sizeCard.style.opacity = '0.5';
        sizeCard.style.pointerEvents = 'none';
        document.getElementById('size-slider').value = 50;
        document.getElementById('size-badge').textContent = '50mm (fixed)';
    } else {
        APP.selectedHeight = 150;
        sizeCard.style.opacity = '';
        sizeCard.style.pointerEvents = '';
        document.getElementById('size-slider').value = 150;
    }

    APP.selectedMaterial = 'abs';
    APP.selectedColor = MATERIALS.abs.colors[0];
    APP.selectedFinish = MATERIALS.abs.finishes[0];

    renderMaterials();
    renderOptions();
    updateSizeUI();
    updatePrice();
    updateRerollUI();
    bindCustomiseEvents();
}

function switchProduct(type) {
    APP.productType = type;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));

    const isKeyring = type === 'keyring';
    const sizeCard = document.getElementById('size-card');

    if (isKeyring) {
        APP.selectedHeight = 50;
        sizeCard.style.opacity = '0.5';
        sizeCard.style.pointerEvents = 'none';
        document.getElementById('size-slider').value = 50;
        document.getElementById('size-badge').textContent = '50mm (fixed)';
    } else {
        APP.selectedHeight = 150;
        sizeCard.style.opacity = '';
        sizeCard.style.pointerEvents = '';
        document.getElementById('size-slider').value = 150;
        document.getElementById('size-badge').textContent = '150mm';
    }

    setModelScale(APP.selectedHeight);
    updateSizeUI();
    updatePrice();
}

function renderMaterials() {
    const grid = document.getElementById('material-grid');
    grid.innerHTML = '';
    Object.values(MATERIALS).forEach(mat => {
        const div = document.createElement('div');
        div.className = `material-option ${mat.id === APP.selectedMaterial ? 'selected' : ''}`;
        div.dataset.id = mat.id;
        div.innerHTML = `
            <div class="material-swatch" style="${mat.swatchStyle}"></div>
            <div class="material-info">
                <div class="material-name">${mat.name}</div>
                <div class="material-desc">${mat.tagline}</div>
            </div>
            <div class="material-price-tag">${mat.tier}</div>
        `;
        div.addEventListener('click', () => selectMaterial(mat.id));
        grid.appendChild(div);
    });
}

function selectMaterial(matId) {
    APP.selectedMaterial = matId;
    const mat = MATERIALS[matId];
    APP.selectedColor = mat.colors[0];
    APP.selectedFinish = mat.finishes[0];

    document.querySelectorAll('.material-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === matId);
    });

    // Clamp size for statue
    if (APP.productType !== 'keyring') {
        const v = validateSize(matId, APP.selectedHeight);
        if (!v.valid && v.clamped) {
            APP.selectedHeight = v.clamped;
            document.getElementById('size-slider').value = APP.selectedHeight;
        }
        document.getElementById('size-slider').max = mat.maxSize;
        document.getElementById('size-slider').min = mat.minSize;
    }

    renderOptions();
    updateSizeUI();
    updatePrice();
}

function renderOptions() {
    const mat = MATERIALS[APP.selectedMaterial];

    // Colours
    const cc = document.getElementById('color-options');
    cc.innerHTML = '';
    mat.colors.forEach((color, i) => {
        const dot = document.createElement('div');
        dot.className = `color-dot ${i === 0 ? 'selected' : ''}`;
        if (color.hex === 'rainbow') dot.classList.add('rainbow');
        else dot.style.backgroundColor = color.hex;
        dot.title = color.name;
        dot.addEventListener('click', () => {
            APP.selectedColor = color;
            cc.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
            dot.classList.add('selected');
            if (color.hex !== 'rainbow') setModelColor(color.hex); else resetModelColor();
        });
        cc.appendChild(dot);
    });

    // Finishes
    const fc = document.getElementById('finish-options');
    fc.innerHTML = '';
    mat.finishes.forEach((finish, i) => {
        const chip = document.createElement('div');
        chip.className = `finish-chip ${i === 0 ? 'selected' : ''}`;
        chip.textContent = finish;
        chip.addEventListener('click', () => {
            APP.selectedFinish = finish;
            fc.querySelectorAll('.finish-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            updatePrice();
        });
        fc.appendChild(chip);
    });
}

function setPreset(size) {
    if (APP.productType === 'keyring') return;
    APP.selectedHeight = size;
    document.getElementById('size-slider').value = size;
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.size) === size);
    });
    setModelScale(size);
    updateSizeUI();
    updatePrice();
}

function bindCustomiseEvents() {
    const slider = document.getElementById('size-slider');
    slider.addEventListener('input', () => {
        APP.selectedHeight = parseInt(slider.value);
        document.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.size) === APP.selectedHeight);
        });
        setModelScale(APP.selectedHeight);
        updateSizeUI();
        updatePrice();
    });
}

function updateSizeUI() {
    const mat = MATERIALS[APP.selectedMaterial];
    if (APP.productType !== 'keyring') {
        document.getElementById('size-badge').textContent = APP.selectedHeight + 'mm';
        document.getElementById('size-min-label').textContent = mat.minSize + 'mm';
        document.getElementById('size-max-label').textContent = mat.maxSize + 'mm';
    }

    const v = validateSize(APP.selectedMaterial, APP.selectedHeight);
    const w = document.getElementById('size-warning');
    if (!v.valid) { w.textContent = '⚠️ ' + v.message; w.classList.add('visible'); }
    else w.classList.remove('visible');
}

function updatePrice() {
    const result = calculatePrice(APP.selectedMaterial, APP.selectedHeight, APP.selectedFinish);
    if (!result) return;
    APP.price = result;

    // Update all price displays
    const priceStr = '$' + result.total.toFixed(2) + ' AUD';
    document.getElementById('btn-order').textContent = `Continue · ${priceStr}`;
}

function resetView() {
    if (viewerControls) {
        viewerControls.reset();
        viewerControls.autoRotate = true;
    }
}

// ─── Order (Screen 3) ───
function goToOrder() {
    // Capture 3D viewer snapshot
    if (viewerRenderer) {
        viewerRenderer.render(viewerScene, viewerCamera);
        const dataUrl = viewerRenderer.domElement.toDataURL('image/png');
        document.getElementById('order-preview-img').src = dataUrl;
    }

    const mat = MATERIALS[APP.selectedMaterial];
    const priceStr = '$' + APP.price.total.toFixed(2) + ' AUD';

    document.getElementById('order-total-price').textContent = priceStr;
    document.getElementById('order-product').textContent = APP.productType === 'keyring' ? 'Keyring' : 'Statue';
    document.getElementById('order-material').textContent = mat.name;
    document.getElementById('order-size').textContent = APP.selectedHeight + 'mm';

    // Colour display (read-only)
    const occ = document.getElementById('order-color-display');
    occ.innerHTML = '';
    const selDot = document.createElement('div');
    selDot.className = 'color-dot selected';
    if (APP.selectedColor.hex === 'rainbow') selDot.classList.add('rainbow');
    else selDot.style.backgroundColor = APP.selectedColor.hex;
    selDot.title = APP.selectedColor.name;
    occ.appendChild(selDot);
    const label = document.createElement('span');
    label.textContent = APP.selectedColor.name;
    label.style.cssText = 'font-size:14px; font-weight:500; margin-left:4px;';
    occ.appendChild(label);

    // Finish display (read-only)
    const ofc = document.getElementById('order-finish-display');
    ofc.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'finish-chip selected';
    chip.textContent = APP.selectedFinish;
    ofc.appendChild(chip);

    showScreen('order');
}

function placeOrder() {
    showScreen('success');
    document.getElementById('success-order-id').textContent = 'PP-' + Date.now().toString(36).toUpperCase();
}

// ─── Reroll ───
async function rerollModel() {
    if (APP.remaining <= 0) {
        alert('No regenerations left today. Try again tomorrow!');
        return;
    }
    if (!APP.uploadedFile) return;

    showProcessing('Regenerating model...', 'Trying a new version');
    try {
        const formData = new FormData();
        formData.append('file', APP.uploadedFile);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();

        setProgress(25);
        const genRes = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: uploadData.path, product_type: APP.productType }),
        });

        if (!genRes.ok) {
            const err = await genRes.json();
            throw new Error(err.detail || 'Generation failed');
        }

        const genData = await genRes.json();
        if (genData.remaining !== undefined) APP.remaining = genData.remaining;

        if (genData.task_id) {
            document.getElementById('processing-text').textContent = 'Creating 3D model...';
            await pollModelStatus(genData.task_id);
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        setProgress(100);
        hideProcessing();

        // Reload model in viewer
        loadModel(APP.modelUrl || '/static/model.glb');
        updateRerollUI();
    } catch (err) {
        hideProcessing();
        alert(err.message);
    }
}

function updateRerollUI() {
    const btn = document.getElementById('btn-reroll');
    const count = document.getElementById('reroll-count');
    count.textContent = APP.remaining;
    btn.disabled = APP.remaining <= 0;
}

// ─── Init ───
showScreen('upload');
