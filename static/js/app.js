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
    processedImage: null,   // URL of Gemini-processed image
    processedPath: null,    // server path for Meshy step
    uploadPath: null,       // original upload server path
    bankedImage: null,      // banked Gemini image URL
    bankedPath: null,       // banked server path
    meshyTaskId: null,      // for Shapeways quote lookup
    shapewaysModelId: null, // Shapeways model ID
    shapewaysQuotes: null,  // real Shapeways material quotes
    _shapewaysBronzeCost: null, // bronze cost from Shapeways
};

// ─── Navigation ───
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');
    APP.currentScreen = screenId;

    const steps = ['upload', 'approve', 'customise', 'order'];
    const idx = steps.indexOf(screenId);
    document.querySelectorAll('.step-dot').forEach((d, i) => {
        d.className = 'step-dot';
        if (i < idx) d.classList.add('done');
        if (i === idx) d.classList.add('active');
    });

    const labels = { upload: 'Step 1 of 4', approve: 'Step 2 of 4', customise: 'Step 3 of 4', order: 'Step 4 of 4', success: '✓ Complete' };
    document.getElementById('nav-step').textContent = labels[screenId] || '';
    document.getElementById('nav-back').style.display = idx > 0 ? '' : 'none';
    window.scrollTo(0, 0);
}

function goBack() {
    const flow = ['upload', 'approve', 'customise', 'order'];
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

    // Require sign-in
    requireAuth(() => {
        APP.email = currentUser.email;
        showProcessing('Uploading your photo...', 'This will take a moment');
        registerAndProcess(currentUser.email, APP.uploadedFile);
    });
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
        await uploadAndProcessImage(file);
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

// Step 1: Upload + Gemini processing (cheap — rerollable)
async function uploadAndProcessImage(file) {
    try {
        setProgress(10);
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error('Upload failed');
        const uploadData = await uploadRes.json();
        APP.uploadPath = uploadData.path;

        setProgress(30);
        document.getElementById('processing-text').textContent = APP.productType === 'keyring'
            ? 'Creating keyring charm...' : 'Processing your photo...';
        document.getElementById('processing-sub').textContent = 'This takes a few seconds';

        const procRes = await fetch('/api/process-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: uploadData.path, product_type: APP.productType }),
        });
        if (!procRes.ok) {
            const err = await procRes.json();
            throw new Error(err.detail || 'Processing failed');
        }
        const procData = await procRes.json();
        APP.processedImage = procData.processed_image;
        APP.processedPath = procData.processed_path;

        setProgress(100);
        hideProcessing();

        // Reset banked state and show approval screen
        APP.bankedImage = null;
        APP.bankedPath = null;
        document.getElementById('banked-section').style.display = 'none';
        document.getElementById('approve-img').src = APP.processedImage;
        document.getElementById('approve-remaining').textContent = APP.remaining;
        showScreen('approve');

    } catch (err) {
        hideProcessing();
        console.error(err);
        alert('Processing failed: ' + err.message);
    }
}

// Bank current image — saves to floating hold slot
function bankCurrent() {
    if (!APP.processedImage) return;
    APP.bankedImage = APP.processedImage;
    APP.bankedPath = APP.processedPath;

    document.getElementById('banked-img').src = APP.bankedImage;
    document.getElementById('banked-section').style.display = 'block';
}

// Swap banked ↔ current (clicking the hold piece)
function swapBanked() {
    if (!APP.bankedImage) return;
    const tempImg = APP.processedImage;
    const tempPath = APP.processedPath;

    APP.processedImage = APP.bankedImage;
    APP.processedPath = APP.bankedPath;
    APP.bankedImage = tempImg;
    APP.bankedPath = tempPath;

    document.getElementById('approve-img').src = APP.processedImage;
    document.getElementById('banked-img').src = APP.bankedImage;
}

// Confirm modal before generating
function showConfirmModal() {
    document.getElementById('confirm-img').src = APP.processedImage;
    document.getElementById('confirm-modal').classList.add('active');
}

function hideConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
}

function confirmGenerate() {
    hideConfirmModal();
    approveAndGenerate();
}

// Reroll Gemini (free — doesn't touch Meshy)
async function rerollGemini() {
    showProcessing(
        APP.productType === 'keyring' ? 'Regenerating charm...' : 'Reprocessing photo...',
        'Free reroll'
    );

    try {
        setProgress(30);
        const procRes = await fetch('/api/process-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: APP.uploadPath, product_type: APP.productType }),
        });
        if (!procRes.ok) throw new Error('Reroll failed');
        const procData = await procRes.json();
        APP.processedImage = procData.processed_image;
        APP.processedPath = procData.processed_path;

        setProgress(100);
        hideProcessing();
        document.getElementById('approve-img').src = APP.processedImage + '?t=' + Date.now();
    } catch (err) {
        hideProcessing();
        alert('Reroll failed: ' + err.message);
    }
}

// Step 2: User approved — now spend Meshy credits
async function approveAndGenerate() {
    showProcessing('Creating 3D model...', 'This usually takes 2-4 minutes');

    try {
        setProgress(10);
        const genRes = await fetch('/api/generate-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processed_path: APP.processedPath }),
        });

        if (!genRes.ok) {
            const err = await genRes.json();
            throw new Error(err.detail || 'Generation failed');
        }

        const genData = await genRes.json();
        if (genData.remaining !== undefined) APP.remaining = genData.remaining;

        if (genData.task_id) {
            APP.meshyTaskId = genData.task_id;
            const result = await pollModelStatus(genData.task_id);
            if (result && result.shapeways_model_id) {
                APP.shapewaysModelId = result.shapeways_model_id;
            }
        } else if (genData.model_url) {
            APP.modelUrl = genData.model_url;
        }

        setProgress(100);
        hideProcessing();

        if (APP.productType === 'keyring') {
            APP.quoteLoaded = true; // fixed price, no need to wait
        }

        initCustomise();
        showScreen('customise');

        // Fetch Shapeways quote in background for statues
        if (APP.meshyTaskId && APP.productType !== 'keyring') {
            fetchShapewaysQuoteWithRetry(APP.meshyTaskId);
        }
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
            if (data.status === 'completed') {
                APP.modelUrl = data.model_url;
                return data;
            }
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

    // Set product label
    document.getElementById('product-label').textContent = 
        APP.productType === 'keyring' ? '🔑 Keyring' : '🗿 Statue';

    const isKeyring = APP.productType === 'keyring';
    const sizeCard = document.getElementById('size-card');
    const materialCard = document.getElementById('material-card');

    if (isKeyring) {
        // Keyring: locked to bronze, 50mm
        APP.selectedHeight = 50;
        APP.selectedMaterial = 'bronze';
        APP.selectedColor = MATERIALS.bronze.colors[0];
        APP.selectedFinish = MATERIALS.bronze.finishes[0];

        sizeCard.style.opacity = '0.5';
        sizeCard.style.pointerEvents = 'none';
        document.getElementById('size-slider').value = 50;
        document.getElementById('size-badge').textContent = '50mm (fixed)';

        if (materialCard) {
            materialCard.style.opacity = '0.5';
            materialCard.style.pointerEvents = 'none';
        }
    } else {
        APP.selectedHeight = 150;
        APP.selectedMaterial = 'abs';
        APP.selectedColor = MATERIALS.abs.colors[0];
        APP.selectedFinish = MATERIALS.abs.finishes[0];

        sizeCard.style.opacity = '';
        sizeCard.style.pointerEvents = '';
        if (materialCard) {
            materialCard.style.opacity = '';
            materialCard.style.pointerEvents = '';
        }
    }

    renderMaterials();
    renderOptions();
    updateSizeUI();
    updatePrice();
    updateRerollUI();
    bindCustomiseEvents();
}

// ─── Shapeways Real Quotes ───
APP.quoteLoaded = false;

async function fetchShapewaysQuoteWithRetry(taskId) {
    APP.quoteLoaded = false;
    updatePrice(); // show "Retrieving quote..." state

    // First wait longer — Shapeways needs time to process the model
    await new Promise(r => setTimeout(r, 10000));

    // Then retry up to 10 times
    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        console.log(`Shapeways quote attempt ${attempt + 1}...`);

        try {
            const res = await fetch(`/api/shapeways-quote/${taskId}`);
            const data = await res.json();

            if (data.source === 'shapeways' && data.all_materials && Object.keys(data.all_materials).length > 0) {
                APP.shapewaysQuotes = data.all_materials;
                APP.shapewaysDimensions = data.dimensions;

                for (const [matId, quote] of Object.entries(data.all_materials)) {
                    const name = quote.name.toLowerCase();
                    console.log(`  Material ${matId}: ${quote.name} = $${quote.shapeways_cost}`);
                    if (name.includes('bronze')) {
                        APP._shapewaysBronzeCost = quote.shapeways_cost;
                        console.log(`  → Matched bronze: $${quote.shapeways_cost}`);
                    }
                }

                if (data.bronze_raw) APP._shapewaysBronzeCost = data.bronze_raw.shapeways_cost;
                if (data.bronze) APP._shapewaysBronzeCost = data.bronze.shapeways_cost;

                APP.quoteLoaded = true;
                console.log('Shapeways quotes loaded:', data.all_materials);
                updatePrice();
                return;
            }

            if (data.error) {
                console.log(`Shapeways: ${data.error}, retrying...`);
            }
        } catch (e) {
            console.error('Shapeways quote error:', e);
        }
    }

    // Gave up — use estimates
    console.log('Shapeways quote unavailable, using estimates');
    APP.quoteLoaded = true; // stop showing "retrieving"
    updatePrice();
}

// switchProduct removed — product type is locked from Screen 1

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

    if (mat.finishInfo) {
        // Rich finish cards (bronze)
        mat.finishes.forEach((finish, i) => {
            const info = mat.finishInfo[finish] || {};
            const card = document.createElement('div');
            card.className = `finish-card ${i === 0 ? 'selected' : ''}`;
            card.innerHTML = `
                <div class="finish-card-swatch" style="background:${info.color || '#CD7F32'}"></div>
                <div class="finish-card-info">
                    <div class="finish-card-name">${finish}</div>
                    <div class="finish-card-desc">${info.desc || ''}</div>
                </div>
            `;
            card.addEventListener('click', () => {
                APP.selectedFinish = finish;
                fc.querySelectorAll('.finish-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                updatePrice();
            });
            fc.appendChild(card);
        });
    } else {
        // Simple chips (ABS, sandstone)
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
    let result;

    if (APP.productType === 'keyring') {
        // Keyring: fixed pricing ($240 + $80)
        result = calculateKeyringPrice();
    } else {
        // Statue: check for real Shapeways quote for selected material
        const swQuotes = APP.shapewaysQuotes || {};
        let realCost = null;

        // Try to find matching Shapeways material
        const matName = MATERIALS[APP.selectedMaterial]?.name?.toLowerCase() || '';
        for (const [matId, quote] of Object.entries(swQuotes)) {
            const qName = quote.name.toLowerCase();
            if (matName.includes('bronze') && qName.includes('bronze')) {
                realCost = quote.shapeways_cost;
                break;
            }
            if (matName.includes('sandstone') && (qName.includes('sandstone') || qName.includes('full color'))) {
                realCost = quote.shapeways_cost;
                break;
            }
            if (matName.includes('abs') && (qName.includes('plastic') || qName.includes('nylon') || qName.includes('versatile'))) {
                realCost = quote.shapeways_cost;
                break;
            }
        }

        if (realCost) {
            // Use real Shapeways cost + our tiered margin
            const marginPct = MARGIN_TIERS[APP.selectedMaterial] || 0.65;
            let markup = realCost * marginPct;
            if (markup < (MIN_PROFIT + API_COST_PER_ORDER)) {
                markup = MIN_PROFIT + API_COST_PER_ORDER;
            }
            result = {
                baseCost: realCost,
                markup: markup,
                total: realCost + markup,
                source: 'shapeways',
            };
        } else {
            // Fallback to local estimate
            result = calculatePrice(APP.selectedMaterial, APP.selectedHeight, APP.selectedFinish);
        }
    }

    if (!result) return;
    APP.price = result;

    const orderBtn = document.getElementById('btn-order');

    if (!APP.quoteLoaded || result.pending) {
        orderBtn.textContent = '⏳ Retrieving quote...';
        orderBtn.disabled = true;
        return;
    }

    if (result.total <= 0) {
        orderBtn.textContent = '⏳ Retrieving quote...';
        orderBtn.disabled = true;
        return;
    }

    const priceStr = '$' + result.total.toFixed(2) + ' AUD';
    const source = result.source === 'shapeways' ? '' : ' (est.)';
    orderBtn.textContent = `Continue · ${priceStr}${source}`;
    orderBtn.disabled = false;
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
    document.getElementById('order-product').textContent = APP.productType === 'keyring' ? 'Keyring (Bronze)' : 'Statue';
    document.getElementById('order-material').textContent = APP.productType === 'keyring' ? 'Lost Wax Bronze' : mat.name;
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
    const orderId = 'PP-' + Date.now().toString(36).toUpperCase();

    // Save model for repeat orders
    if (typeof saveModel === 'function') {
        saveModel({
            modelUrl: APP.modelUrl,
            processedImage: APP.processedImage,
            processedPath: APP.processedPath,
            sourceImage: APP.previewUrl,
            productType: APP.productType,
            material: APP.selectedMaterial,
            date: new Date().toLocaleDateString(),
        });
    }

    // Save order
    if (typeof addOrder === 'function') {
        addOrder({
            id: orderId,
            product: APP.productType === 'keyring' ? 'Keyring' : 'Statue',
            material: MATERIALS[APP.selectedMaterial]?.name || APP.selectedMaterial,
            size: APP.selectedHeight + 'mm',
            price: '$' + APP.price.total.toFixed(2) + ' AUD',
            status: 'Processing',
            date: new Date().toISOString(),
        });
    }

    showScreen('success');
    document.getElementById('success-order-id').textContent = orderId;
}

// ─── Reroll 3D Model (costs Meshy credits) ───
async function rerollModel() {
    if (APP.remaining <= 0) {
        alert('No regenerations left today. Try again tomorrow!');
        return;
    }
    if (!APP.processedPath) return;

    showProcessing('Regenerating 3D model...', 'Uses 1 daily credit');
    try {
        setProgress(10);
        const genRes = await fetch('/api/generate-3d', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processed_path: APP.processedPath }),
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

// ─── Collapsible ───
function toggleCollapsible(id) {
    const el = document.getElementById(id);
    const arrow = document.getElementById(id + '-arrow');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (arrow) arrow.classList.add('open');
    } else {
        el.style.display = 'none';
        if (arrow) arrow.classList.remove('open');
    }
}

// ─── Social Sharing ───
function shareTo(platform) {
    const text = encodeURIComponent('Just ordered a custom 3D-printed pet keepsake from PawPrints! 🐾✨');
    const url = encodeURIComponent('https://douphraite.com');
    const links = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
        whatsapp: `https://wa.me/?text=${text}%20${url}`,
    };
    if (links[platform]) window.open(links[platform], '_blank');
}

function copyShareLink() {
    navigator.clipboard.writeText('https://douphraite.com').then(() => {
        alert('Link copied! 📋');
    });
}

// ─── Init ───
showScreen('upload');
